import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { canonicalPathInside, CSS_BUNDLE_ENTRY, CSS_BUNDLE_ID, diagnostic, errorDetail, formatDiagnostic, inside, isStyleEntry, normalizeOptions, RESOLVED_CSS_BUNDLE_ID, VITE_MANIFEST, viteConfig } from './config.js';
import type { NormalizedOptions, ShopifyThemeOptions } from './config.js';
import { acquireLock, atomicWrite, readManifest, readOwnershipState, readText, releaseLock, removeFile, sha, STATE_FILE, updateLock } from './ownership.js';
import type { LockOwner } from './ownership.js';
import { developmentSnippet, HOT_RELOAD_CLIENT, HOT_RELOAD_EVENT, HOT_RELOAD_SOURCE, renderProductionSnippet, INLINE_ASSET_LIMIT, inlineSizeWarning, RESOLVED_HOT_RELOAD_CLIENT, snippetSizeWarning, sourceKey } from './snippets.js';

type DiagnosticEvent = 'BUILD_OUTPUT_WRITTEN' | 'CONFIG_RESOLVED' | 'DEVELOPMENT_ACTIVATED' | 'DEVELOPMENT_RESTORED' | 'HOT_RELOAD' | 'OWNERSHIP_ACQUIRED' | 'OWNERSHIP_RELEASED';

/** Sync mode keeps this many published generations of hashed assets, so a slow Shopify upload never loses files a remote snippet still names. */
const SYNC_RETAINED_GENERATIONS = 10;

export function shopifyTheme(raw: ShopifyThemeOptions): Plugin {
  let options: NormalizedOptions;
  let config: ResolvedConfig;
  // Present only while the temporary development snippet is installed.
  let development: { hash: string; original: { exists: boolean; content: string } } | undefined;
  let exitHandler: (() => void) | undefined;
  let signalHandlers: Partial<Record<NodeJS.Signals, () => void>> = {};
  let owner: LockOwner | undefined;
  let cssCodeSplit = true;
  // Sync mode: `vite build --watch` owns the theme root for the whole session and publishes one generation per rebuild.
  let watching = false;
  let generations: string[][] = [];
  const logDiagnostic = (event: DiagnosticEvent, message: string) => {
    if (options.diagnostics) config.logger.info(`[shopify-theme:diagnostic:${event}] ${message}`);
  };
  const restoreDevelopmentSnippet = () => {
    if (!development || !existsSync(options.snippet)) return false;
    const snippet = canonicalPathInside(options.themeRoot, options.snippet, 'Development snippet', true);
    if (sha(readText(snippet, 'development snippet')) !== development.hash) return false;
    if (development.original.exists) atomicWrite(snippet, development.original.content); else removeFile(snippet, 'temporary development snippet');
    development = undefined;
    logDiagnostic('DEVELOPMENT_RESTORED', `snippet=${sourceKey(options.snippet, options.themeRoot)}`);
    return true;
  };
  // When a sync session ends, only the latest generation is still needed: the snippet on disk names it.
  const pruneToLatestGeneration = () => {
    const latest = generations.at(-1);
    if (!owner || !latest || generations.length < 2) return;
    const assetsRoot = canonicalPathInside(options.themeRoot, resolve(options.themeRoot, 'assets'), 'Shopify assets directory');
    const statePath = canonicalPathInside(options.themeRoot, resolve(options.themeRoot, STATE_FILE), 'Generated asset ownership state');
    const recorded = readOwnershipState(statePath).files;
    const keep = new Set(latest);
    const stale = recorded.filter((file) => !keep.has(file)).map((file) => resolveOwnedAsset(options.themeRoot, assetsRoot, file)).filter((target) => existsSync(target));
    for (const target of stale) removeFile(target, 'retained plugin-owned asset');
    atomicWrite(statePath, `${JSON.stringify({ files: [...latest].sort() }, null, 2)}\n`);
    generations = [latest];
  };
  const release = () => {
    let failure: unknown;
    try { pruneToLatestGeneration(); } catch (error) { failure = error; }
    try { restoreDevelopmentSnippet(); } catch (error) { failure ??= error; }
    try {
      if (releaseLock(options.themeRoot, owner)) logDiagnostic('OWNERSHIP_RELEASED', `mode=${owner?.mode} root=${options.themeRoot}`);
    } catch (error) { failure ??= error; }
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
    configResolved(resolved) {
      config = resolved;
      watching = resolved.command === 'build' && Boolean(resolved.build?.watch);
      logDiagnostic('CONFIG_RESOLVED', `command=${resolved.command} root=${options.themeRoot} entries=${Object.keys(options.entries).length} snippet=${sourceKey(options.snippet, options.themeRoot)}`);
    },
    buildStart() {
      if (config.command !== 'build' || owner) return;
      owner = acquireLock(options.themeRoot, 'build');
      logDiagnostic('OWNERSHIP_ACQUIRED', `mode=build root=${options.themeRoot}`);
      installProcessHandlers();
      if (watching) config.logger.info('[shopify-theme] Sync mode: rebuilding on change; assets are served by Shopify, so no tunnel is needed.');
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
      let writtenSnippet: { path: string; generatedHash: string; original: { exists: boolean; content: string } } | undefined;
      try {
        const assetsRoot = canonicalPathInside(options.themeRoot, resolve(options.themeRoot, 'assets'), 'Shopify assets directory');
        const statePath = canonicalPathInside(options.themeRoot, resolve(options.themeRoot, STATE_FILE), 'Generated asset ownership state');
        const previous = existsSync(statePath) ? readOwnershipState(statePath) : { files: [] };
        const manifestPath = canonicalPathInside(options.themeRoot, resolve(assetsRoot, VITE_MANIFEST), 'Vite build manifest', true);
        const manifest = readManifest(manifestPath);
        const files = Object.keys(bundle).filter((file) => file !== VITE_MANIFEST).sort();
        const aggregateCss = cssCodeSplit ? undefined : manifest[CSS_BUNDLE_ENTRY]?.file;
        if (!cssCodeSplit && (!aggregateCss || !aggregateCss.endsWith('.css'))) {
          throw diagnostic('BUILD_CSS_MISSING', `Vite did not generate the aggregated CSS asset expected at manifest entry "${CSS_BUNDLE_ENTRY}". Run a clean build and confirm that build.cssCodeSplit remains false.`);
        }
        const snippet = canonicalPathInside(options.themeRoot, options.snippet, 'Generated Liquid snippet');
        const originalSnippet = existsSync(snippet) ? { exists: true, content: readText(snippet, 'existing Liquid snippet') } : { exists: false, content: '' };
        const oversized: string[] = [];
        const canInline = (file: string, entry: string) => {
          const output = bundle[file];
          const bytes = output?.type === 'asset' ? Buffer.byteLength(output.source) : 0;
          if (bytes < INLINE_ASSET_LIMIT) return true;
          oversized.push(inlineSizeWarning(entry, file, bytes));
          return false;
        };
        const generatedSnippet = renderProductionSnippet(manifest, options.entries, options.themeRoot, {
          modulePreload: config.build.modulePreload !== false,
          aggregateCss,
          entryOptions: options.entryOptions,
          canInline,
        });
        for (const warning of oversized) config.logger.warn(warning);
        const sizeWarning = snippetSizeWarning(generatedSnippet, sourceKey(snippet, options.themeRoot));
        if (sizeWarning) config.logger.warn(sizeWarning);
        // An unchanged snippet is not rewritten, so Shopify CLI sees no change and the preview does not refresh.
        const snippetChanged = !(watching && originalSnippet.exists && originalSnippet.content === generatedSnippet);
        if (snippetChanged) {
          atomicWrite(snippet, generatedSnippet);
          writtenSnippet = { path: snippet, generatedHash: sha(generatedSnippet), original: originalSnippet };
        }
        const previousGeneration = new Set(generations.at(-1));
        const kept = watching ? [...new Set([...generations.slice(1 - SYNC_RETAINED_GENERATIONS).flat(), ...files])].sort() : files;
        const current = new Set(kept);
        const stale = previous.files
          .filter((file) => !current.has(file))
          .map((file) => resolveOwnedAsset(options.themeRoot, assetsRoot, file))
          .filter((target) => existsSync(target));
        // Record old and new files together before deleting anything, so a failed
        // cleanup or state write never leaves generated assets untracked.
        if (stale.length) atomicWrite(statePath, `${JSON.stringify({ files: [...new Set([...previous.files, ...kept])].sort() }, null, 2)}\n`);
        for (const target of stale) removeFile(target, 'stale plugin-owned asset');
        const removed = stale.length;
        atomicWrite(statePath, `${JSON.stringify({ files: kept }, null, 2)}\n`);
        if (watching) {
          generations = [...generations.slice(1 - SYNC_RETAINED_GENERATIONS), files];
          if (owner && !owner.published) { owner.published = true; updateLock(options.themeRoot, owner); }
          const added = files.filter((file) => !previousGeneration.has(file)).length;
          config.logger.info(`[shopify-theme] Synced ${added} new ${added === 1 ? 'asset' : 'assets'}; snippet ${snippetChanged ? 'updated' : 'unchanged'}.`);
        }
        logDiagnostic('BUILD_OUTPUT_WRITTEN', `assets=${files.length} removed=${removed} snippet=${sourceKey(snippet, options.themeRoot)}`);
      } catch (error) {
        let rollbackError: unknown;
        try {
          if (writtenSnippet && existsSync(writtenSnippet.path) && sha(readText(writtenSnippet.path, 'generated Liquid snippet')) === writtenSnippet.generatedHash) {
            if (writtenSnippet.original.exists) atomicWrite(writtenSnippet.path, writtenSnippet.original.content);
            else removeFile(writtenSnippet.path, 'generated Liquid snippet');
          }
        } catch (failure) { rollbackError = failure; }
        try { if (!watching) cleanup(); } catch (cleanupError) {
          throw diagnostic('BUILD_CLEANUP_FAILED', `Build processing failed and ownership cleanup also failed (${errorDetail(cleanupError)}). Resolve the cleanup error before retrying.`, new AggregateError([error, cleanupError]));
        }
        if (rollbackError) throw diagnostic('BUILD_ROLLBACK_FAILED', `Build processing failed and the prior Liquid snippet could not be restored (${errorDetail(rollbackError)}). Preserve the snippet manually before retrying.`, new AggregateError([error, rollbackError]));
        throw error;
      }
    },
    buildEnd(error) { if (error && config.command === 'build' && !watching) cleanup(); },
    closeBundle() { if (config.command === 'build' && !watching) cleanup(); },
    closeWatcher() { if (watching) cleanup(); },
    configureServer(server: ViteDevServer) {
      if (!server.httpServer && !options.devOrigin) {
        throw diagnostic('DEV_ORIGIN_UNAVAILABLE', 'The Vite server has no HTTP server (middleware mode), so the development origin cannot be determined. Configure `devOrigin` or run Vite with its own HTTP server.');
      }
      owner = acquireLock(options.themeRoot, 'development');
      logDiagnostic('OWNERSHIP_ACQUIRED', `mode=development root=${options.themeRoot}`);
      installProcessHandlers();
      const activate = () => {
        try {
          const origin = options.devOrigin?.origin ?? localOrigin(server);
          const snippet = canonicalPathInside(options.themeRoot, options.snippet, 'Development snippet');
          const original = existsSync(snippet) ? { exists: true, content: readText(snippet, 'existing Liquid snippet') } : { exists: false, content: '' };
          const content = developmentSnippet(origin, options.entries, options.themeRoot, options.entryOptions);
          atomicWrite(snippet, content);
          const developmentHash = sha(content);
          development = { hash: developmentHash, original };
          if (!owner) throw diagnostic('DEV_OWNERSHIP_LOST', `Development ownership for theme root "${options.themeRoot}" was lost before server startup. Stop other Vite processes and retry.`);
          owner.development = { snippet, developmentHash, original };
          updateLock(options.themeRoot, owner);
          const entryCount = Object.keys(options.entries).length;
          logDiagnostic('DEVELOPMENT_ACTIVATED', `origin=${origin} entries=${entryCount} snippet=${sourceKey(options.snippet, options.themeRoot)}`);
          config.logger.info(`[shopify-theme] Development assets ready at ${origin} (${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}; snippet: ${sourceKey(options.snippet, options.themeRoot)}).`);
          if (options.devOrigin) {
            config.logger.warn(formatDiagnostic('DEV_EXTERNAL_ORIGIN', `External development origin ${origin} must use HTTPS and remain stable. You are responsible for keeping an HTTP and WebSocket tunnel running; the plugin configures Vite but does not create or manage the tunnel.`));
          }
        } catch (error) {
          try { cleanup(); } catch { /* preserve startup diagnostic */ }
          throw error;
        }
      };
      if (!server.httpServer || server.httpServer.listening) activate(); else server.httpServer.once('listening', activate);
      server.httpServer?.once('close', cleanup);
    },
    closeServer() { cleanup(); },
    handleHotUpdate(context) {
      if (!/\.(liquid|json)$/i.test(context.file) || !inside(options.themeRoot, context.file)) return;
      canonicalPathInside(options.themeRoot, context.file, 'Changed theme file');
      logDiagnostic('HOT_RELOAD', `file=${sourceKey(context.file, options.themeRoot)}`);
      context.server.ws.send({ type: 'custom', event: HOT_RELOAD_EVENT, data: {} });
      return [];
    },
  };
}

function resolveOwnedAsset(themeRoot: string, assetsRoot: string, file: string): string {
  const target = canonicalPathInside(themeRoot, resolve(assetsRoot, file), `Recorded plugin-owned asset "${file}"`);
  if (!inside(assetsRoot, target)) throw diagnostic('PATH_OUTSIDE_THEME', `Recorded plugin-owned asset "${file}" resolves outside the assets directory.`);
  return target;
}

function localOrigin(server: ViteDevServer): string {
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw diagnostic('DEV_ORIGIN_UNAVAILABLE', 'Could not determine the Vite development origin because the HTTP server has no TCP address. Wait for the server to listen or configure `devOrigin`.');
  const configuredHost = server.config.server.host;
  const host = typeof configuredHost === 'string' && configuredHost !== '0.0.0.0' && configuredHost !== '::' ? configuredHost : 'localhost';
  return `${server.config.server.https ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
}

export default shopifyTheme;
