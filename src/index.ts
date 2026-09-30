import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Manifest, ManifestChunk, Plugin, ResolvedConfig, ViteDevServer } from 'vite';

export interface ShopifyThemeOptions {
  entries: Record<string, string>;
  themeRoot?: string;
  snippet?: string;
  devOrigin?: string;
}

export interface NormalizedOptions {
  entries: Record<string, string>;
  themeRoot: string;
  snippet: string;
  devOrigin?: URL;
}

const STATE_FILE = '.vite-shopify-theme.json';
const VITE_MANIFEST = 'vite-manifest.json';
const HOT_RELOAD_CLIENT = 'virtual:shopify-theme-hot-reload';
const RESOLVED_HOT_RELOAD_CLIENT = `\0${HOT_RELOAD_CLIENT}`;
const HOT_RELOAD_CLIENT_PATH = `/@id/__x00__${HOT_RELOAD_CLIENT}`;
const HOT_RELOAD_EVENT = 'shopify:theme-update';
const HOT_RELOAD_SOURCE = `const reloadKey = 'vite-plugin-shopify-theme:reload';
const reloadDelay = 1000;
const pendingReload = Number(sessionStorage.getItem(reloadKey));
if (pendingReload) {
  sessionStorage.removeItem(reloadKey);
  setTimeout(() => window.location.reload(), Math.max(0, reloadDelay - (Date.now() - pendingReload)));
}
if (import.meta.hot) {
  const rememberReload = () => sessionStorage.setItem(reloadKey, String(Date.now()));
  import.meta.hot.on('vite:beforeFullReload', rememberReload);
  import.meta.hot.on('${HOT_RELOAD_EVENT}', () => {
    rememberReload();
    window.location.reload();
  });
}
`;

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function normalizeOptions(options: ShopifyThemeOptions, cwd = process.cwd()): NormalizedOptions {
  if (!options || !options.entries || Object.keys(options.entries).length === 0) {
    throw new Error('[shopify-theme] `entries` must contain at least one Liquid name/source mapping.');
  }
  const themeRoot = resolve(cwd, options.themeRoot ?? '.');
  const snippet = resolve(themeRoot, options.snippet ?? 'snippets/vite-tag.liquid');
  if (!inside(themeRoot, snippet)) throw new Error('[shopify-theme] `snippet` must stay inside themeRoot.');
  const entries: Record<string, string> = {};
  const sources = new Set<string>();
  for (const [name, source] of Object.entries(options.entries)) {
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      throw new Error(`[shopify-theme] Invalid Liquid entry name: ${JSON.stringify(name)}.`);
    }
    const absolute = resolve(themeRoot, source);
    if (!inside(themeRoot, absolute)) throw new Error(`[shopify-theme] Entry ${name} resolves outside themeRoot.`);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`[shopify-theme] Entry ${name} does not exist: ${source}.`);
    if (sources.has(absolute)) throw new Error(`[shopify-theme] Duplicate entry source: ${source}.`);
    sources.add(absolute);
    entries[name] = absolute;
  }
  let devOrigin: URL | undefined;
  if (options.devOrigin) {
    try { devOrigin = new URL(options.devOrigin); } catch { throw new Error('[shopify-theme] devOrigin must be a valid absolute HTTPS URL.'); }
    if (devOrigin.protocol !== 'https:' || devOrigin.username || devOrigin.password || devOrigin.pathname !== '/' || devOrigin.search || devOrigin.hash) {
      throw new Error('[shopify-theme] devOrigin must be an HTTPS origin without credentials, path, query, or hash.');
    }
  }
  return { entries, themeRoot, snippet, devOrigin };
}

function sourceKey(path: string, root: string): string { return relative(root, path).split(sep).join('/'); }

export interface ManifestTags { preloads: string[]; styles: string[]; scripts: string[] }

export function collectManifestTags(manifest: Manifest, entrySources: string[]): ManifestTags {
  const preloads: string[] = [];
  const styles: string[] = [];
  const scripts: string[] = [];
  const seenImports = new Set<string>();
  const seenCss = new Set<string>();
  const seenScripts = new Set<string>();
  const visit = (key: string, root = false): void => {
    const chunk = manifest[key];
    if (!chunk) throw new Error(`[shopify-theme] Vite manifest is missing declared entry ${key}.`);
    for (const imported of chunk.imports ?? []) {
      if (!seenImports.has(imported)) {
        seenImports.add(imported);
        visit(imported);
        const importedChunk = manifest[imported];
        if (importedChunk?.file.endsWith('.js')) preloads.push(importedChunk.file);
      }
    }
    if (chunk.file.endsWith('.css') && !seenCss.has(chunk.file)) { seenCss.add(chunk.file); styles.push(chunk.file); }
    for (const css of chunk.css ?? []) if (!seenCss.has(css)) { seenCss.add(css); styles.push(css); }
    if (root && !seenScripts.has(chunk.file)) { seenScripts.add(chunk.file); scripts.push(chunk.file); }
  };
  for (const source of entrySources) visit(source, true);
  return { preloads, styles, scripts };
}

const asset = (file: string) => `{{ '${file.replaceAll("'", "\\'")}' | asset_url }}`;

export function productionSnippet(manifest: Manifest, entries: Record<string, string>, root: string): string {
  const blocks = Object.entries(entries).map(([name, path]) => {
    const tags = collectManifestTags(manifest, [sourceKey(path, root)]);
    const lines = [
      ...tags.preloads.map((f) => `<link rel="modulepreload" href="${asset(f)}">`),
      ...tags.styles.map((f) => `<link rel="stylesheet" href="${asset(f)}">`),
      ...tags.scripts.filter((f) => f.endsWith('.js')).map((f) => `<script type="module" src="${asset(f)}"></script>`),
    ];
    return `{% when '${name}' %}\n${lines.join('\n')}`;
  });
  return `{% comment %} Generated by vite-plugin-shopify-theme. Do not edit. {% endcomment %}\n{% case entry %}\n${blocks.join('\n')}\n{% endcase %}\n`;
}

export function developmentSnippet(origin: string, entries: Record<string, string>, root: string): string {
  const blocks = Object.entries(entries).map(([name, path]) => {
    const url = `${origin}/${sourceKey(path, root)}`;
    const tag = /\.css$/i.test(path)
      ? `<link rel="stylesheet" href="${url}">`
      : `<script type="module" src="${url}"></script>`;
    return `{% when '${name}' %}\n${tag}`;
  });
  return `{% comment %} Temporary development file generated by vite-plugin-shopify-theme. {% endcomment %}\n{% if entry == blank %}\n<script type="module" src="${origin}/@vite/client"></script>\n<script type="module" src="${origin}${HOT_RELOAD_CLIENT_PATH}"></script>\n{% else %}\n{% case entry %}\n${blocks.join('\n')}\n{% endcase %}\n{% endif %}\n`;
}

function sha(content: string): string { return createHash('sha256').update(content).digest('hex'); }

export function shopifyTheme(raw: ShopifyThemeOptions): Plugin {
  let options: NormalizedOptions;
  let config: ResolvedConfig;
  let original: { exists: boolean; content: string } | undefined;
  let developmentHash: string | undefined;
  let developmentActive = false;
  let exitHandler: (() => void) | undefined;
  let signalHandlers: Partial<Record<NodeJS.Signals, () => void>> = {};
  const restoreDevelopmentSnippet = () => {
    if (!developmentActive || !existsSync(options.snippet) || sha(readFileSync(options.snippet, 'utf8')) !== developmentHash) return;
    if (original?.exists) writeFileSync(options.snippet, original.content); else unlinkSync(options.snippet);
    developmentActive = false;
  };
  const removeProcessHandlers = () => {
    if (exitHandler) process.off('exit', exitHandler);
    for (const [signal, handler] of Object.entries(signalHandlers)) process.off(signal as NodeJS.Signals, handler);
    exitHandler = undefined;
    signalHandlers = {};
  };
  return {
    name: 'vite-plugin-shopify-theme',
    enforce: 'pre',
    resolveId(id) { if (id === HOT_RELOAD_CLIENT) return RESOLVED_HOT_RELOAD_CLIENT; },
    load(id) { if (id === RESOLVED_HOT_RELOAD_CLIENT) return HOT_RELOAD_SOURCE; },
    config(user) {
      options = normalizeOptions(raw, user.root ? resolve(user.root) : process.cwd());
      if (user.appType && user.appType !== 'custom') throw new Error('[shopify-theme] appType conflicts with required value "custom".');
      if (user.base && user.base !== './') throw new Error('[shopify-theme] base conflicts with required relative base "./".');
      if (user.build?.outDir || user.build?.emptyOutDir === true || user.build?.manifest || user.build?.rolldownOptions?.input) {
        throw new Error('[shopify-theme] build output, manifest, and input are owned by the plugin; remove the conflicting build configuration.');
      }
      // Keep each declared Liquid name distinct; stripping extensions would make
      // common pairs such as theme.css/theme.ts overwrite one another.
      const input = Object.fromEntries(Object.entries(options.entries).map(([name, path]) => [name, path]));
      const server = options.devOrigin ? {
        cors: { origin: options.devOrigin.origin },
        allowedHosts: [options.devOrigin.hostname],
        hmr: { protocol: 'wss' as const, host: options.devOrigin.hostname, clientPort: Number(options.devOrigin.port || 443) },
      } : undefined;
      return {
        root: options.themeRoot,
        appType: 'custom',
        base: './',
        server,
        build: {
          outDir: resolve(options.themeRoot, 'assets'), emptyOutDir: false, manifest: VITE_MANIFEST,
          rolldownOptions: { input, output: { entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js', assetFileNames: '[name]-[hash][extname]' } },
        },
      };
    },
    configResolved(resolved) { config = resolved; },
    buildStart() {
      if (config.command !== 'build') return;
      const statePath = resolve(options.themeRoot, STATE_FILE);
      if (!existsSync(statePath)) return;
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as { files?: string[] };
      for (const file of state.files ?? []) {
        const target = resolve(options.themeRoot, 'assets', file);
        if (inside(resolve(options.themeRoot, 'assets'), target) && existsSync(target)) unlinkSync(target);
      }
    },
    writeBundle(_output, bundle) {
      if (config.command !== 'build') return;
      const manifestPath = resolve(options.themeRoot, 'assets', VITE_MANIFEST);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
      writeFileSync(options.snippet, productionSnippet(manifest, options.entries, options.themeRoot));
      const files = Object.keys(bundle).filter((file) => file !== VITE_MANIFEST);
      writeFileSync(resolve(options.themeRoot, STATE_FILE), `${JSON.stringify({ files }, null, 2)}\n`);
    },
    configureServer(server: ViteDevServer) {
      const activate = () => {
        const origin = options.devOrigin?.origin ?? localOrigin(server);
        original = existsSync(options.snippet) ? { exists: true, content: readFileSync(options.snippet, 'utf8') } : { exists: false, content: '' };
        const content = developmentSnippet(origin, options.entries, options.themeRoot);
        writeFileSync(options.snippet, content);
        developmentHash = sha(content);
        developmentActive = true;
        exitHandler = restoreDevelopmentSnippet;
        process.once('exit', exitHandler);
        for (const signal of ['SIGINT', 'SIGTERM'] as const) {
          const handler = () => {
            restoreDevelopmentSnippet();
            removeProcessHandlers();
            process.kill(process.pid, signal);
          };
          signalHandlers[signal] = handler;
          process.once(signal, handler);
        }
      };
      server.httpServer?.once('listening', activate);
      server.httpServer?.once('close', restoreDevelopmentSnippet);
    },
    closeServer() {
      restoreDevelopmentSnippet();
      removeProcessHandlers();
    },
    handleHotUpdate(context) {
      if (!/\.(liquid|json)$/i.test(context.file) || !inside(options.themeRoot, context.file)) return;
      context.server.ws.send({ type: 'custom', event: HOT_RELOAD_EVENT, data: {} });
      return [];
    },
  };
}

function localOrigin(server: ViteDevServer): string {
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('[shopify-theme] Could not determine the Vite development origin.');
  const configuredHost = server.config.server.host;
  const host = typeof configuredHost === 'string' && configuredHost !== '0.0.0.0' && configuredHost !== '::' ? configuredHost : 'localhost';
  return `${server.config.server.https ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
}

export default shopifyTheme;
