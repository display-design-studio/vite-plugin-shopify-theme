import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync,
  rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
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
const LOCK_DIR = '.vite-shopify-theme.lock';
const LOCK_FILE = 'owner.json';
const VITE_MANIFEST = 'vite-manifest.json';
const HOT_RELOAD_CLIENT = 'virtual:shopify-theme-hot-reload';
const RESOLVED_HOT_RELOAD_CLIENT = `\0${HOT_RELOAD_CLIENT}`;
const HOT_RELOAD_CLIENT_PATH = `/@id/__x00__${HOT_RELOAD_CLIENT}`;
const HOT_RELOAD_EVENT = 'shopify:theme-update';
const STYLE_ENTRY_RE = /\.(?:css|scss|sass|less|styl|stylus)$/i;
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

/** Replace a file without exposing a partially-written value. */
function atomicWrite(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const existingMode = existsSync(path) ? statSync(path).mode & 0o777 : undefined;
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', mode ?? existingMode ?? 0o666);
    writeFileSync(descriptor, content, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    if (existingMode !== undefined) chmodSync(temporary, existingMode);
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

interface DevelopmentRecovery {
  snippet: string;
  developmentHash: string;
  original: { exists: boolean; content: string };
}

interface LockOwner {
  token: string;
  pid: number;
  mode: 'build' | 'development';
  startedAt: string;
  development?: DevelopmentRecovery;
}

function lockPath(root: string): string { return resolve(root, LOCK_DIR); }
function ownerPath(root: string): string { return resolve(lockPath(root), LOCK_FILE); }

function readOwner(root: string): LockOwner | undefined {
  try { return JSON.parse(readFileSync(ownerPath(root), 'utf8')) as LockOwner; } catch { return undefined; }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function recoverDevelopment(root: string, owner: LockOwner): void {
  const recovery = owner.development;
  if (!recovery || !inside(root, recovery.snippet) || !existsSync(recovery.snippet)) return;
  if (sha(readFileSync(recovery.snippet, 'utf8')) !== recovery.developmentHash) return;
  if (recovery.original.exists) atomicWrite(recovery.snippet, recovery.original.content);
  else unlinkSync(recovery.snippet);
}

function acquireLock(root: string, mode: LockOwner['mode']): LockOwner {
  const owner: LockOwner = { token: randomUUID(), pid: process.pid, mode, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      mkdirSync(lockPath(root));
      atomicWrite(ownerPath(root), `${JSON.stringify(owner, null, 2)}\n`);
      return owner;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      const current = readOwner(root);
      if (current && processIsAlive(current.pid)) {
        throw new Error(`[shopify-theme] Cannot start ${mode}: ${current.mode} process ${current.pid} has owned ${root} since ${current.startedAt}. Stop it before trying again.`);
      }
      if (current) recoverDevelopment(root, current);
      const stalePath = `${lockPath(root)}.stale.${owner.token}`;
      try {
        renameSync(lockPath(root), stalePath);
        rmSync(stalePath, { recursive: true });
      } catch (removeError) {
        if ((removeError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new Error(`[shopify-theme] Could not reclaim stale ownership at ${lockPath(root)}: ${(removeError as Error).message}`);
      }
    }
  }
  throw new Error('[shopify-theme] Could not acquire theme ownership.');
}

function updateLock(root: string, owner: LockOwner): void {
  const current = readOwner(root);
  if (!current || current.token !== owner.token) throw new Error('[shopify-theme] Theme ownership changed unexpectedly.');
  atomicWrite(ownerPath(root), `${JSON.stringify(owner, null, 2)}\n`);
}

function releaseLock(root: string, owner: LockOwner | undefined): void {
  if (!owner || readOwner(root)?.token !== owner.token) return;
  rmSync(lockPath(root), { recursive: true });
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
  const addStyles = (chunk: ManifestChunk): void => {
    if (chunk.file.endsWith('.css') && !seenCss.has(chunk.file)) { seenCss.add(chunk.file); styles.push(chunk.file); }
    for (const css of chunk.css ?? []) if (!seenCss.has(css)) { seenCss.add(css); styles.push(css); }
  };
  const visitImports = (key: string): void => {
    const chunk = manifest[key];
    if (!chunk) throw new Error(`[shopify-theme] Vite manifest is missing declared entry ${key}.`);
    for (const imported of chunk.imports ?? []) {
      if (!seenImports.has(imported)) {
        seenImports.add(imported);
        const importedChunk = manifest[imported];
        if (!importedChunk) throw new Error(`[shopify-theme] Vite manifest is missing imported chunk ${imported}.`);
        visitImports(imported);
        addStyles(importedChunk);
        if (importedChunk?.file.endsWith('.js')) preloads.push(importedChunk.file);
      }
    }
  };
  for (const source of entrySources) {
    const chunk = manifest[source];
    if (!chunk) throw new Error(`[shopify-theme] Vite manifest is missing declared entry ${source}.`);
    addStyles(chunk);
    visitImports(source);
    if (!seenScripts.has(chunk.file)) { seenScripts.add(chunk.file); scripts.push(chunk.file); }
  }
  return { preloads, styles, scripts };
}

const asset = (file: string) => `{{ '${file.replaceAll("'", "\\'")}' | asset_url }}`;

export function productionSnippet(manifest: Manifest, entries: Record<string, string>, root: string): string {
  const blocks = Object.entries(entries).map(([name, path]) => {
    const tags = collectManifestTags(manifest, [sourceKey(path, root)]);
    const lines = [
      ...tags.styles.map((f) => `<link rel="stylesheet" href="${asset(f)}">`),
      ...tags.scripts.filter((f) => f.endsWith('.js')).map((f) => `<script type="module" src="${asset(f)}"></script>`),
      ...tags.preloads.map((f) => `<link rel="modulepreload" href="${asset(f)}">`),
    ];
    return `{% when '${name}' %}\n${lines.join('\n')}`;
  });
  return `{% comment %} Generated by vite-plugin-shopify-theme. Do not edit. {% endcomment %}\n{% case entry %}\n${blocks.join('\n')}\n{% endcase %}\n`;
}

export function developmentSnippet(origin: string, entries: Record<string, string>, root: string): string {
  const blocks = Object.entries(entries).map(([name, path]) => {
    const url = `${origin}/${sourceKey(path, root)}`;
    const tag = STYLE_ENTRY_RE.test(path)
      ? `<link rel="stylesheet" href="${url}" crossorigin="anonymous">`
      : `<script type="module" src="${url}" crossorigin="anonymous"></script>`;
    return `{% when '${name}' %}\n${tag}`;
  });
  return `{% comment %} Temporary development file generated by vite-plugin-shopify-theme. {% endcomment %}\n{% if entry == blank %}\n<script type="module" src="${origin}/@vite/client" crossorigin="anonymous"></script>\n<script type="module" src="${origin}${HOT_RELOAD_CLIENT_PATH}" crossorigin="anonymous"></script>\n{% else %}\n{% case entry %}\n${blocks.join('\n')}\n{% endcase %}\n{% endif %}\n`;
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
  let owner: LockOwner | undefined;
  const restoreDevelopmentSnippet = () => {
    if (!developmentActive || !existsSync(options.snippet) || sha(readFileSync(options.snippet, 'utf8')) !== developmentHash) return;
    if (original?.exists) atomicWrite(options.snippet, original.content); else unlinkSync(options.snippet);
    developmentActive = false;
  };
  const release = () => {
    restoreDevelopmentSnippet();
    releaseLock(options.themeRoot, owner);
    owner = undefined;
  };
  const removeProcessHandlers = () => {
    if (exitHandler) process.off('exit', exitHandler);
    for (const [signal, handler] of Object.entries(signalHandlers)) process.off(signal as NodeJS.Signals, handler);
    exitHandler = undefined;
    signalHandlers = {};
  };
  const cleanup = () => {
    release();
    removeProcessHandlers();
  };
  const installProcessHandlers = () => {
    exitHandler = release;
    process.once('exit', exitHandler);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const handler = () => {
        cleanup();
        process.kill(process.pid, signal);
      };
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
      if (user.appType && user.appType !== 'custom') throw new Error('[shopify-theme] appType conflicts with required value "custom".');
      if (user.base && user.base !== './') throw new Error('[shopify-theme] base conflicts with required relative base "./".');
      if (user.publicDir !== undefined && user.publicDir !== false) throw new Error('[shopify-theme] publicDir conflicts with required value false.');
      if (user.input !== undefined || user.build?.outDir || user.build?.emptyOutDir === true || user.build?.manifest || user.build?.rolldownOptions?.input !== undefined) {
        throw new Error('[shopify-theme] build output, manifest, and input are owned by the plugin; remove the conflicting build configuration.');
      }
      // Keep each declared Liquid name distinct; stripping extensions would make
      // common pairs such as theme.css/theme.ts overwrite one another.
      const input = Object.fromEntries(Object.entries(options.entries).map(([name, path]) => [name, path]));
      const server = options.devOrigin ? {
        cors: { origin: options.devOrigin.origin },
        allowedHosts: [options.devOrigin.hostname],
        ws: { protocol: 'wss' as const, host: options.devOrigin.hostname, clientPort: Number(options.devOrigin.port || 443) },
      } : undefined;
      return {
        root: options.themeRoot,
        appType: 'custom',
        base: './',
        publicDir: false,
        input,
        server,
        build: {
          outDir: resolve(options.themeRoot, 'assets'), emptyOutDir: false, manifest: VITE_MANIFEST,
          rolldownOptions: { output: { entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js', assetFileNames: '[name]-[hash][extname]' } },
        },
      };
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
        const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) as { files?: string[] } : {};
        const manifest = JSON.parse(readFileSync(resolve(assetsRoot, VITE_MANIFEST), 'utf8')) as Manifest;
        const files = Object.keys(bundle).filter((file) => file !== VITE_MANIFEST).sort();
        atomicWrite(options.snippet, productionSnippet(manifest, options.entries, options.themeRoot));
        const current = new Set(files);
        for (const file of previous.files ?? []) {
          const target = resolve(assetsRoot, file);
          if (!current.has(file) && inside(assetsRoot, target) && existsSync(target)) unlinkSync(target);
        }
        atomicWrite(statePath, `${JSON.stringify({ files }, null, 2)}\n`);
      } catch (error) {
        cleanup();
        throw error;
      }
    },
    buildEnd(error) { if (error && config.command === 'build') cleanup(); },
    closeBundle() { if (config.command === 'build') cleanup(); },
    configureServer(server: ViteDevServer) {
      owner = acquireLock(options.themeRoot, 'development');
      installProcessHandlers();
      const activate = () => {
        const origin = options.devOrigin?.origin ?? localOrigin(server);
        original = existsSync(options.snippet) ? { exists: true, content: readFileSync(options.snippet, 'utf8') } : { exists: false, content: '' };
        const content = developmentSnippet(origin, options.entries, options.themeRoot);
        atomicWrite(options.snippet, content);
        developmentHash = sha(content);
        developmentActive = true;
        if (!owner) throw new Error('[shopify-theme] Development ownership was lost before startup.');
        owner.development = { snippet: options.snippet, developmentHash, original };
        updateLock(options.themeRoot, owner);
      };
      server.httpServer?.once('listening', activate);
      server.httpServer?.once('close', cleanup);
    },
    closeServer() {
      cleanup();
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
