import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { diagnostic, errorDetail, inside, normalizeOptions, VITE_MANIFEST, viteConfig } from './config.js';
import type { NormalizedOptions, ShopifyThemeOptions } from './config.js';
import { acquireLock, atomicWrite, readManifest, readOwnershipState, readText, releaseLock, removeFile, sha, STATE_FILE, updateLock } from './ownership.js';
import type { LockOwner } from './ownership.js';
import { developmentSnippet, HOT_RELOAD_CLIENT, HOT_RELOAD_EVENT, HOT_RELOAD_SOURCE, productionSnippet, RESOLVED_HOT_RELOAD_CLIENT, sourceKey } from './snippets.js';

export function shopifyTheme(raw: ShopifyThemeOptions): Plugin {
  let options: NormalizedOptions;
  let config: ResolvedConfig;
  let original: { exists: boolean; content: string } | undefined;
  let developmentHash: string | undefined;
  let developmentActive = false;
  let exitHandler: (() => void) | undefined;
  let signalHandlers: Partial<Record<NodeJS.Signals, () => void>> = {};
  let owner: LockOwner | undefined;
  const restoreDevelopmentSnippet = () => {
    if (!developmentActive || !existsSync(options.snippet) || sha(readText(options.snippet, 'development snippet')) !== developmentHash) return;
    if (original?.exists) atomicWrite(options.snippet, original.content); else removeFile(options.snippet, 'temporary development snippet');
    developmentActive = false;
  };
  const release = () => {
    let failure: unknown;
    try { restoreDevelopmentSnippet(); } catch (error) { failure = error; }
    try { releaseLock(options.themeRoot, owner); } catch (error) { failure ??= error; }
    owner = undefined;
    if (failure) throw failure;
  };
  const removeProcessHandlers = () => {
    if (exitHandler) process.off('exit', exitHandler);
    for (const [signal, handler] of Object.entries(signalHandlers)) process.off(signal as NodeJS.Signals, handler);
    exitHandler = undefined;
    signalHandlers = {};
  };
  const cleanup = () => { release(); removeProcessHandlers(); };
  const installProcessHandlers = () => {
    exitHandler = release;
    process.once('exit', exitHandler);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const handler = () => { cleanup(); process.kill(process.pid, signal); };
      signalHandlers[signal] = handler;
      process.once(signal, handler);
    }
  };
  return {
    name: 'vite-plugin-shopify-theme',
    enforce: 'pre',
    resolveId(id) { if (id === HOT_RELOAD_CLIENT) return RESOLVED_HOT_RELOAD_CLIENT; },
    load(id) { if (id === RESOLVED_HOT_RELOAD_CLIENT) return HOT_RELOAD_SOURCE; },
    config(user) {
      options = normalizeOptions(raw, user.root ? resolve(user.root) : process.cwd());
      return viteConfig(options, user);
    },
    configResolved(resolved) { config = resolved; },
    buildStart() {
      if (config.command !== 'build') return;
      owner = acquireLock(options.themeRoot, 'build');
      installProcessHandlers();
    },
    writeBundle(_output, bundle) {
      if (config.command !== 'build') return;
      try {
        const assetsRoot = resolve(options.themeRoot, 'assets');
        const statePath = resolve(options.themeRoot, STATE_FILE);
        const previous = existsSync(statePath) ? readOwnershipState(statePath) : { files: [] };
        const manifest = readManifest(resolve(assetsRoot, VITE_MANIFEST));
        const files = Object.keys(bundle).filter((file) => file !== VITE_MANIFEST).sort();
        atomicWrite(options.snippet, productionSnippet(manifest, options.entries, options.themeRoot));
        const current = new Set(files);
        for (const file of previous.files) {
          const target = resolve(assetsRoot, file);
          if (!current.has(file) && inside(assetsRoot, target) && existsSync(target)) removeFile(target, 'stale plugin-owned asset');
        }
        atomicWrite(statePath, `${JSON.stringify({ files }, null, 2)}\n`);
      } catch (error) {
        try { cleanup(); } catch (cleanupError) {
          throw diagnostic(`Build processing failed and ownership cleanup also failed (${errorDetail(cleanupError)}). Resolve the cleanup error before retrying.`, new AggregateError([error, cleanupError]));
        }
        throw error;
      }
    },
    buildEnd(error) { if (error && config.command === 'build') cleanup(); },
    closeBundle() { if (config.command === 'build') cleanup(); },
    configureServer(server: ViteDevServer) {
      owner = acquireLock(options.themeRoot, 'development');
      installProcessHandlers();
      const activate = () => {
        try {
          const origin = options.devOrigin?.origin ?? localOrigin(server);
          original = existsSync(options.snippet) ? { exists: true, content: readText(options.snippet, 'existing Liquid snippet') } : { exists: false, content: '' };
          const content = developmentSnippet(origin, options.entries, options.themeRoot);
          atomicWrite(options.snippet, content);
          developmentHash = sha(content);
          developmentActive = true;
          if (!owner) throw diagnostic(`Development ownership for theme root "${options.themeRoot}" was lost before server startup. Stop other Vite processes and retry.`);
          owner.development = { snippet: options.snippet, developmentHash, original };
          updateLock(options.themeRoot, owner);
          const entryCount = Object.keys(options.entries).length;
          config.logger.info(`[shopify-theme] Development assets ready at ${origin} (${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}; snippet: ${sourceKey(options.snippet, options.themeRoot)}).`);
        } catch (error) {
          try { cleanup(); } catch { /* preserve startup diagnostic */ }
          throw error;
        }
      };
      server.httpServer?.once('listening', activate);
      server.httpServer?.once('close', cleanup);
    },
    closeServer() { cleanup(); },
    handleHotUpdate(context) {
      if (!/\.(liquid|json)$/i.test(context.file) || !inside(options.themeRoot, context.file)) return;
      context.server.ws.send({ type: 'custom', event: HOT_RELOAD_EVENT, data: {} });
      return [];
    },
  };
}

function localOrigin(server: ViteDevServer): string {
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw diagnostic('Could not determine the Vite development origin because the HTTP server has no TCP address. Wait for the server to listen or configure `devOrigin`.');
  const configuredHost = server.config.server.host;
  const host = typeof configuredHost === 'string' && configuredHost !== '0.0.0.0' && configuredHost !== '::' ? configuredHost : 'localhost';
  return `${server.config.server.https ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
}

export default shopifyTheme;
