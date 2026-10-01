import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { CSS_BUNDLE_ENTRY, CSS_BUNDLE_ID, diagnostic, errorDetail, inside, isStyleEntry, normalizeOptions, RESOLVED_CSS_BUNDLE_ID, VITE_MANIFEST, viteConfig } from './config.js';
import type { NormalizedOptions, ShopifyThemeOptions } from './config.js';
import { acquireLock, atomicWrite, readManifest, readOwnershipState, readText, releaseLock, removeFile, sha, STATE_FILE, updateLock } from './ownership.js';
import type { LockOwner } from './ownership.js';
import { developmentSnippet, HOT_RELOAD_CLIENT, HOT_RELOAD_EVENT, HOT_RELOAD_SOURCE, renderProductionSnippet, RESOLVED_HOT_RELOAD_CLIENT, sourceKey } from './snippets.js';

export function shopifyTheme(raw: ShopifyThemeOptions): Plugin {
  let options: NormalizedOptions;
  let config: ResolvedConfig;
  let original: { exists: boolean; content: string } | undefined;
  let developmentHash: string | undefined;
  let developmentActive = false;
  let exitHandler: (() => void) | undefined;
  let signalHandlers: Partial<Record<NodeJS.Signals, () => void>> = {};
  let owner: LockOwner | undefined;
  let cssCodeSplit = true;
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
    resolveId(id) {
      if (id === HOT_RELOAD_CLIENT) return RESOLVED_HOT_RELOAD_CLIENT;
      if (!cssCodeSplit && id === CSS_BUNDLE_ID) return RESOLVED_CSS_BUNDLE_ID;
    },
    load(id) {
      if (id === RESOLVED_HOT_RELOAD_CLIENT) return HOT_RELOAD_SOURCE;
      if (!cssCodeSplit && id === RESOLVED_CSS_BUNDLE_ID) {
        return Object.values(options.entries).filter(isStyleEntry).map((path) => `import ${JSON.stringify(path)};`).join('\n');
      }
    },
    config(user, environment) {
      options = normalizeOptions(raw, user.root ? resolve(user.root) : process.cwd());
      cssCodeSplit = environment.command !== 'build' || user.build?.cssCodeSplit !== false;
      return viteConfig(options, user, !cssCodeSplit);
    },
    configResolved(resolved) { config = resolved; },
    buildStart() {
      if (config.command !== 'build') return;
      owner = acquireLock(options.themeRoot, 'build');
      installProcessHandlers();
    },
    generateBundle: {
      order: 'post',
      handler(_output, bundle) {
        if (config.command !== 'build' || cssCodeSplit) return;
        for (const [file, output] of Object.entries(bundle)) {
          if (output.type === 'chunk' && output.facadeModuleId === RESOLVED_CSS_BUNDLE_ID) delete bundle[file];
        }
      },
    },
    writeBundle(_output, bundle) {
      if (config.command !== 'build') return;
      try {
        const assetsRoot = resolve(options.themeRoot, 'assets');
        const statePath = resolve(options.themeRoot, STATE_FILE);
        const previous = existsSync(statePath) ? readOwnershipState(statePath) : { files: [] };
        const manifest = readManifest(resolve(assetsRoot, VITE_MANIFEST));
        const files = Object.keys(bundle).filter((file) => file !== VITE_MANIFEST).sort();
        const aggregateCss = cssCodeSplit ? undefined : manifest[CSS_BUNDLE_ENTRY]?.file;
        if (!cssCodeSplit && (!aggregateCss || !aggregateCss.endsWith('.css'))) {
          throw diagnostic(`Vite did not generate the aggregated CSS asset expected at manifest entry "${CSS_BUNDLE_ENTRY}". Run a clean build and confirm that build.cssCodeSplit remains false.`);
        }
        atomicWrite(options.snippet, renderProductionSnippet(manifest, options.entries, options.themeRoot, {
          modulePreload: config.build.modulePreload !== false,
          aggregateCss,
        }));
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
          if (options.devOrigin) {
            config.logger.warn(`[shopify-theme] External development origin ${origin} must use HTTPS and remain stable. You are responsible for keeping an HTTP and WebSocket tunnel running; the plugin configures Vite but does not create or manage the tunnel.`);
          }
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
