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

function diagnostic(message: string, cause?: unknown): Error {
  return new Error(`[shopify-theme] ${message}`, cause === undefined ? undefined : { cause });
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  return `${code ? `${code}: ` : ''}${error.message}`;
}

function displayValue(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return Object.prototype.toString.call(value); }
}

function readText(path: string, purpose: string): string {
  try { return readFileSync(path, 'utf8'); } catch (error) {
    throw diagnostic(`Could not read ${purpose} at "${path}" (${errorDetail(error)}). Check that the file exists and is readable.`, error);
  }
}

function parseJson(path: string, purpose: string): unknown {
  const content = readText(path, purpose);
  try { return JSON.parse(content); } catch (error) {
    throw diagnostic(`Could not parse ${purpose} at "${path}" as JSON (${errorDetail(error)}). Repair or remove this file before retrying.`, error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeFile(path: string, purpose: string): void {
  try { unlinkSync(path); } catch (error) {
    throw diagnostic(`Could not remove ${purpose} at "${path}" (${errorDetail(error)}). Check ownership and permissions, then retry.`, error);
  }
}

/** Replace a file without exposing a partially-written value. */
function atomicWrite(path: string, content: string, mode?: number): void {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const existingMode = existsSync(path) ? statSync(path).mode & 0o777 : undefined;
    descriptor = openSync(temporary, 'wx', mode ?? existingMode ?? 0o666);
    writeFileSync(descriptor, content, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    if (existingMode !== undefined) chmodSync(temporary, existingMode);
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* best-effort cleanup */ }
    if (existsSync(temporary)) try { unlinkSync(temporary); } catch { /* preserve the primary error */ }
    throw diagnostic(`Could not atomically write generated file "${path}" (${errorDetail(error)}). Check that its parent directory is writable and retry.`, error);
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

interface OwnershipState { files: string[] }

function readOwnershipState(path: string): OwnershipState {
  const value = parseJson(path, 'generated asset ownership state');
  if (!isRecord(value) || !Array.isArray(value.files) || !value.files.every((file) => typeof file === 'string' && file.length > 0 && basename(file) === file)) {
    throw diagnostic(`Generated asset ownership state at "${path}" has an invalid structure. Expected { "files": ["flat-asset-name"] }. Repair or remove this file before retrying; no recorded assets were deleted.`);
  }
  return { files: value.files as string[] };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readManifest(path: string): Manifest {
  const value = parseJson(path, 'Vite build manifest');
  if (!isRecord(value)) throw diagnostic(`Vite build manifest at "${path}" must be a JSON object. Run a clean Vite build and retry.`);
  for (const [key, chunk] of Object.entries(value)) {
    if (!isRecord(chunk) || typeof chunk.file !== 'string' || chunk.file.length === 0
      || (chunk.imports !== undefined && !isStringArray(chunk.imports))
      || (chunk.css !== undefined && !isStringArray(chunk.css))) {
      throw diagnostic(`Vite build manifest entry ${JSON.stringify(key)} at "${path}" is invalid. Run a clean Vite build and retry.`);
    }
  }
  return value as Manifest;
}

function lockPath(root: string): string { return resolve(root, LOCK_DIR); }
function ownerPath(root: string): string { return resolve(lockPath(root), LOCK_FILE); }

function isOriginal(value: unknown): value is DevelopmentRecovery['original'] {
  return isRecord(value) && typeof value.exists === 'boolean' && typeof value.content === 'string';
}

function isDevelopmentRecovery(value: unknown): value is DevelopmentRecovery {
  return isRecord(value) && typeof value.snippet === 'string' && typeof value.developmentHash === 'string' && isOriginal(value.original);
}

function isLockOwner(value: unknown): value is LockOwner {
  return isRecord(value)
    && typeof value.token === 'string' && value.token.length > 0
    && Number.isInteger(value.pid) && (value.pid as number) > 0
    && (value.mode === 'build' || value.mode === 'development')
    && typeof value.startedAt === 'string' && value.startedAt.length > 0
    && (value.development === undefined || isDevelopmentRecovery(value.development));
}

function readOwner(root: string): LockOwner | undefined {
  const path = ownerPath(root);
  if (!existsSync(lockPath(root))) return undefined;
  if (!existsSync(path)) {
    throw diagnostic(`Ownership lock "${lockPath(root)}" is missing metadata "${path}". Do not remove it while another process may be running; after confirming no Vite process owns this theme, remove the lock directory and retry.`);
  }
  let value: unknown;
  try { value = parseJson(path, 'ownership metadata'); } catch (error) {
    throw diagnostic(`Ownership metadata at "${path}" could not be read or parsed (${errorDetail(error)}). Do not remove it while another process may be running; after confirming no Vite process owns this theme, remove the lock directory and retry.`, error);
  }
  if (!isLockOwner(value)) {
    throw diagnostic(`Ownership metadata at "${path}" has an invalid structure. Do not remove it while another process may be running; after confirming no Vite process owns this theme, remove the lock directory and retry.`);
  }
  return value;
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
  if (sha(readText(recovery.snippet, 'temporary development snippet')) !== recovery.developmentHash) return;
  if (recovery.original.exists) atomicWrite(recovery.snippet, recovery.original.content);
  else removeFile(recovery.snippet, 'temporary development snippet');
}

function acquireLock(root: string, mode: LockOwner['mode']): LockOwner {
  const owner: LockOwner = { token: randomUUID(), pid: process.pid, mode, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      mkdirSync(lockPath(root));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw diagnostic(`Could not create ownership lock at "${lockPath(root)}" (${errorDetail(error)}). Check that the theme root is writable and retry.`, error);
      }
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
        throw diagnostic(`Could not reclaim stale ownership at "${lockPath(root)}" (${errorDetail(removeError)}). Check ownership and permissions, then retry.`, removeError);
      }
      continue;
    }
    try {
      atomicWrite(ownerPath(root), `${JSON.stringify(owner, null, 2)}\n`);
      return owner;
    } catch (error) {
      try { rmSync(lockPath(root), { recursive: true }); } catch { /* keep the atomic-write diagnostic */ }
      throw error;
    }
  }
  throw diagnostic(`Could not acquire ownership of theme root "${root}" after multiple attempts. Stop other Vite processes and retry.`);
}

function updateLock(root: string, owner: LockOwner): void {
  const current = readOwner(root);
  if (!current || current.token !== owner.token) throw diagnostic(`Theme ownership at "${lockPath(root)}" changed unexpectedly. Stop all Vite processes using this theme before retrying.`);
  atomicWrite(ownerPath(root), `${JSON.stringify(owner, null, 2)}\n`);
}

function releaseLock(root: string, owner: LockOwner | undefined): void {
  if (!owner || readOwner(root)?.token !== owner.token) return;
  try { rmSync(lockPath(root), { recursive: true }); } catch (error) {
    throw diagnostic(`Could not release theme ownership at "${lockPath(root)}" (${errorDetail(error)}). Remove the lock directory after confirming this process has stopped.`, error);
  }
}

export function normalizeOptions(options: ShopifyThemeOptions, cwd = process.cwd()): NormalizedOptions {
  if (!options || !isRecord(options.entries) || Object.keys(options.entries).length === 0) {
    throw diagnostic('`entries` must be an object containing at least one Liquid name/source mapping, for example `{ "theme.ts": "frontend/theme.ts" }`.');
  }
  if (options.themeRoot !== undefined && typeof options.themeRoot !== 'string') throw diagnostic('`themeRoot` must be a filesystem path string.');
  if (options.snippet !== undefined && typeof options.snippet !== 'string') throw diagnostic('`snippet` must be a filesystem path string relative to `themeRoot`.');
  const themeRoot = resolve(cwd, options.themeRoot ?? '.');
  const configuredSnippet = options.snippet ?? 'snippets/vite-tag.liquid';
  const snippet = resolve(themeRoot, configuredSnippet);
  if (!inside(themeRoot, snippet)) throw diagnostic(`Configured snippet "${configuredSnippet}" resolves outside theme root "${themeRoot}". Choose a snippet path inside the theme.`);
  const entries: Record<string, string> = {};
  const sources = new Set<string>();
  for (const [name, source] of Object.entries(options.entries)) {
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      throw diagnostic(`Liquid entry name ${JSON.stringify(name)} is invalid. Use a non-empty flat name without slashes, such as "theme.ts".`);
    }
    if (typeof source !== 'string' || source.length === 0) throw diagnostic(`Entry "${name}" must map to a non-empty source path string.`);
    const absolute = resolve(themeRoot, source);
    if (!inside(themeRoot, absolute)) throw diagnostic(`Entry "${name}" source "${source}" resolves outside theme root "${themeRoot}". Choose a source inside the theme.`);
    if (!existsSync(absolute)) throw diagnostic(`Entry "${name}" source "${source}" was not found at "${absolute}". Create the file or correct the entry path.`);
    let sourceStat;
    try { sourceStat = statSync(absolute); } catch (error) {
      throw diagnostic(`Could not inspect entry "${name}" at "${absolute}" (${errorDetail(error)}). Check that it is readable and retry.`, error);
    }
    if (!sourceStat.isFile()) throw diagnostic(`Entry "${name}" source "${source}" resolves to "${absolute}", which is not a file. Point the entry to a source file.`);
    if (sources.has(absolute)) throw diagnostic(`Entry "${name}" duplicates source "${source}" resolved at "${absolute}". Each Liquid entry must use a distinct source file.`);
    sources.add(absolute);
    entries[name] = absolute;
  }
  let devOrigin: URL | undefined;
  if (options.devOrigin) {
    if (typeof options.devOrigin !== 'string') throw diagnostic(`devOrigin ${displayValue(options.devOrigin)} must be an absolute HTTPS origin string.`);
    try { devOrigin = new URL(options.devOrigin); } catch (error) { throw diagnostic(`devOrigin ${JSON.stringify(options.devOrigin)} is not a valid absolute HTTPS origin. Use a value such as "https://vite.example.com".`, error); }
    if (devOrigin.protocol !== 'https:' || devOrigin.username || devOrigin.password || devOrigin.pathname !== '/' || devOrigin.search || devOrigin.hash) {
      throw diagnostic(`devOrigin "${options.devOrigin}" must use HTTPS and contain only an origin, without credentials, path, query, or hash.`);
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
    if (!chunk) throw diagnostic(`Vite manifest is missing declared entry "${key}". Confirm that plugin-owned top-level input is not overridden and run a clean build.`);
    for (const imported of chunk.imports ?? []) {
      if (!seenImports.has(imported)) {
        seenImports.add(imported);
        const importedChunk = manifest[imported];
        if (!importedChunk) throw diagnostic(`Vite manifest entry "${key}" references missing imported chunk "${imported}". Run a clean build and retry.`);
        visitImports(imported);
        addStyles(importedChunk);
        if (importedChunk?.file.endsWith('.js')) preloads.push(importedChunk.file);
      }
    }
  };
  for (const source of entrySources) {
    const chunk = manifest[source];
    if (!chunk) throw diagnostic(`Vite manifest is missing declared entry "${source}". Confirm that plugin-owned top-level input is not overridden and run a clean build.`);
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

function configurationConflict(key: string, actual: unknown, expected: string): Error {
  return diagnostic(`Vite option "${key}" is ${displayValue(actual)}, but the Shopify theme plugin requires ${expected}. Remove "${key}" from the user config and let the plugin set it.`);
}

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
      if (user.appType !== undefined && user.appType !== 'custom') throw configurationConflict('appType', user.appType, '`"custom"`');
      if (user.base !== undefined && user.base !== './') throw configurationConflict('base', user.base, 'the relative base `"./"`');
      if (user.publicDir !== undefined && user.publicDir !== false) throw configurationConflict('publicDir', user.publicDir, '`false`');
      if (user.input !== undefined) throw configurationConflict('input', user.input, 'the explicit entries supplied to `shopifyTheme()`');
      if (user.build?.outDir !== undefined) throw configurationConflict('build.outDir', user.build.outDir, 'the theme `assets` directory');
      if (user.build?.emptyOutDir === true) throw configurationConflict('build.emptyOutDir', true, '`false` so manual Shopify assets are preserved');
      if (user.build?.manifest !== undefined) throw configurationConflict('build.manifest', user.build.manifest, `the plugin manifest name ${JSON.stringify(VITE_MANIFEST)}`);
      if (user.build?.rolldownOptions?.input !== undefined) throw configurationConflict('build.rolldownOptions.input', user.build.rolldownOptions.input, 'the top-level plugin-owned `input`');
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
        const previous = existsSync(statePath) ? readOwnershipState(statePath) : { files: [] };
        const manifest = readManifest(resolve(assetsRoot, VITE_MANIFEST));
        const files = Object.keys(bundle).filter((file) => file !== VITE_MANIFEST).sort();
        atomicWrite(options.snippet, productionSnippet(manifest, options.entries, options.themeRoot));
        const current = new Set(files);
        for (const file of previous.files ?? []) {
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
        } catch (error) {
          try { cleanup(); } catch { /* preserve the startup diagnostic */ }
          throw error;
        }
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
  if (!address || typeof address === 'string') throw diagnostic('Could not determine the Vite development origin because the HTTP server has no TCP address. Wait for the server to listen or configure `devOrigin`.');
  const configuredHost = server.config.server.host;
  const host = typeof configuredHost === 'string' && configuredHost !== '0.0.0.0' && configuredHost !== '::' ? configuredHost : 'localhost';
  return `${server.config.server.https ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
}

export default shopifyTheme;
