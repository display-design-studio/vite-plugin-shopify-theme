import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { UserConfig } from 'vite';

export const CSS_BUNDLE_ENTRY = 'style.css';
export const CSS_BUNDLE_ID = 'virtual:shopify-theme-css-bundle';
export const RESOLVED_CSS_BUNDLE_ID = `\0${CSS_BUNDLE_ID}`;
const STYLE_ENTRY_RE = /\.(?:css|pcss|postcss|scss|sass|less|styl|stylus)$/i;
const LIQUID_ENTRY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface ShopifyThemeOptions {
  entries: Record<string, string>;
  themeRoot?: string;
  snippet?: string;
  devOrigin?: string;
  diagnostics?: boolean;
}

export interface NormalizedOptions {
  entries: Record<string, string>;
  themeRoot: string;
  snippet: string;
  devOrigin?: URL;
  diagnostics: boolean;
}

export const VITE_MANIFEST = 'vite-manifest.json';

export type DiagnosticCode =
  | 'BUILD_CLEANUP_FAILED' | 'BUILD_CSS_MISSING' | 'BUILD_ROLLBACK_FAILED'
  | 'CONFIG_CSS_ENTRY_RESERVED' | 'CONFIG_DEV_ORIGIN' | 'CONFIG_DIAGNOSTICS' | 'CONFIG_ENTRIES' | 'CONFIG_SNIPPET' | 'CONFIG_THEME_ROOT' | 'CONFIG_VITE_CONFLICT'
  | 'DEV_EXTERNAL_ORIGIN' | 'DEV_ORIGIN_UNAVAILABLE' | 'DEV_OWNERSHIP_LOST'
  | 'FS_JSON_INVALID' | 'FS_READ_FAILED' | 'FS_REMOVE_FAILED' | 'FS_WRITE_FAILED'
  | 'LOCK_ACQUIRE_FAILED' | 'LOCK_ACTIVE' | 'LOCK_CHANGED' | 'LOCK_CREATE_FAILED' | 'LOCK_METADATA_INVALID' | 'LOCK_METADATA_MISSING' | 'LOCK_RECLAIM_FAILED' | 'LOCK_RELEASE_FAILED'
  | 'MANIFEST_ENTRY_MISSING' | 'MANIFEST_IMPORT_MISSING' | 'MANIFEST_INVALID'
  | 'PATH_MISSING' | 'PATH_OUTSIDE_THEME' | 'PATH_RESOLUTION_FAILED'
  | 'STATE_INVALID';

export function isStyleEntry(path: string): boolean { return STYLE_ENTRY_RE.test(path); }

export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** Resolve symlinks in an existing path, or in the nearest existing ancestor. */
export function canonicalPathInside(root: string, path: string, purpose: string, mustExist = false): string {
  const absolute = resolve(path);
  if (!inside(root, absolute)) throw diagnostic('PATH_OUTSIDE_THEME', `${purpose} resolves outside theme root "${root}".`);
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    try {
      if (lstatSync(ancestor).isSymbolicLink()) realpathSync.native(ancestor);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw diagnostic('PATH_RESOLUTION_FAILED', `Could not resolve ${purpose} at "${absolute}" (${errorDetail(error)}).`, error);
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (mustExist && !existsSync(absolute)) throw diagnostic('PATH_MISSING', `${purpose} was not found at "${absolute}".`);
  let canonical: string;
  try {
    const canonicalAncestor = realpathSync.native(ancestor);
    canonical = ancestor === absolute ? canonicalAncestor : resolve(canonicalAncestor, relative(ancestor, absolute));
  } catch (error) {
    throw diagnostic('PATH_RESOLUTION_FAILED', `Could not resolve ${purpose} at "${absolute}" (${errorDetail(error)}).`, error);
  }
  if (!inside(root, canonical)) throw diagnostic('PATH_OUTSIDE_THEME', `${purpose} at "${absolute}" resolves outside canonical theme root "${root}".`);
  return canonical;
}

export function formatDiagnostic(code: DiagnosticCode, message: string): string {
  return `[shopify-theme:${code}] ${message}`;
}

export function diagnostic(code: DiagnosticCode, message: string, cause?: unknown): Error {
  return new Error(formatDiagnostic(code, message), cause === undefined ? undefined : { cause });
}

export function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  return `${code ? `${code}: ` : ''}${error.message}`;
}

export function displayValue(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return Object.prototype.toString.call(value); }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeOptions(options: ShopifyThemeOptions, cwd = process.cwd()): NormalizedOptions {
  if (!options || !isRecord(options.entries) || Object.keys(options.entries).length === 0) {
    throw diagnostic('CONFIG_ENTRIES', '`entries` must be an object containing at least one Liquid name/source mapping, for example `{ "theme.ts": "frontend/theme.ts" }`.');
  }
  if (options.themeRoot !== undefined && typeof options.themeRoot !== 'string') throw diagnostic('CONFIG_THEME_ROOT', '`themeRoot` must be a filesystem path string.');
  if (options.snippet !== undefined && typeof options.snippet !== 'string') throw diagnostic('CONFIG_SNIPPET', '`snippet` must be a filesystem path string relative to `themeRoot`.');
  if (options.diagnostics !== undefined && typeof options.diagnostics !== 'boolean') throw diagnostic('CONFIG_DIAGNOSTICS', '`diagnostics` must be a boolean.');
  const configuredRoot = resolve(cwd, options.themeRoot ?? '.');
  let themeRoot: string;
  try { themeRoot = realpathSync.native(configuredRoot); } catch (error) {
    throw diagnostic('CONFIG_THEME_ROOT', `Could not resolve theme root "${configuredRoot}" (${errorDetail(error)}). Check that it exists and is accessible.`, error);
  }
  if (!statSync(themeRoot).isDirectory()) throw diagnostic('CONFIG_THEME_ROOT', `Theme root "${configuredRoot}" resolves to "${themeRoot}", which is not a directory.`);
  const configuredSnippet = options.snippet ?? 'snippets/vite-tag.liquid';
  const unresolvedSnippet = resolve(themeRoot, configuredSnippet);
  if (!inside(themeRoot, unresolvedSnippet)) throw diagnostic('CONFIG_SNIPPET', `Configured snippet "${configuredSnippet}" resolves outside theme root "${themeRoot}". Choose a snippet path inside the theme.`);
  const snippet = canonicalPathInside(themeRoot, unresolvedSnippet, `Configured snippet "${configuredSnippet}"`);
  const entries: Record<string, string> = {};
  const sources = new Set<string>();
  for (const [name, source] of Object.entries(options.entries)) {
    if (!LIQUID_ENTRY_NAME_RE.test(name)) {
      throw diagnostic('CONFIG_ENTRIES', `Liquid entry name ${JSON.stringify(name)} is invalid. Use only ASCII letters, digits, dots, underscores, and hyphens, starting with a letter or digit, such as "theme.ts".`);
    }
    if (typeof source !== 'string' || source.length === 0) throw diagnostic('CONFIG_ENTRIES', `Entry "${name}" must map to a non-empty source path string.`);
    const unresolved = resolve(themeRoot, source);
    if (!inside(themeRoot, unresolved)) throw diagnostic('CONFIG_ENTRIES', `Entry "${name}" source "${source}" resolves outside theme root "${themeRoot}". Choose a source inside the theme.`);
    if (!existsSync(unresolved)) throw diagnostic('CONFIG_ENTRIES', `Entry "${name}" source "${source}" was not found at "${unresolved}". Create the file or correct the entry path.`);
    const absolute = canonicalPathInside(themeRoot, unresolved, `Entry "${name}" source "${source}"`, true);
    let sourceStat;
    try { sourceStat = statSync(absolute); } catch (error) {
      throw diagnostic('CONFIG_ENTRIES', `Could not inspect entry "${name}" at "${absolute}" (${errorDetail(error)}). Check that it is readable and retry.`, error);
    }
    if (!sourceStat.isFile()) throw diagnostic('CONFIG_ENTRIES', `Entry "${name}" source "${source}" resolves to "${absolute}", which is not a file. Point the entry to a source file.`);
    if (sources.has(absolute)) throw diagnostic('CONFIG_ENTRIES', `Entry "${name}" duplicates source "${source}" resolved at "${absolute}". Each Liquid entry must use a distinct source file.`);
    sources.add(absolute);
    entries[name] = absolute;
  }
  let devOrigin: URL | undefined;
  if (options.devOrigin) {
    if (typeof options.devOrigin !== 'string') throw diagnostic('CONFIG_DEV_ORIGIN', `devOrigin ${displayValue(options.devOrigin)} must be an absolute HTTPS origin string.`);
    try { devOrigin = new URL(options.devOrigin); } catch (error) { throw diagnostic('CONFIG_DEV_ORIGIN', `devOrigin ${JSON.stringify(options.devOrigin)} is not a valid absolute HTTPS origin. Use a value such as "https://vite.example.com".`, error); }
    if (devOrigin.protocol !== 'https:' || devOrigin.username || devOrigin.password || devOrigin.pathname !== '/' || devOrigin.search || devOrigin.hash) {
      throw diagnostic('CONFIG_DEV_ORIGIN', `devOrigin "${options.devOrigin}" must use HTTPS and contain only an origin, without credentials, path, query, or hash.`);
    }
  }
  return { entries, themeRoot, snippet, devOrigin, diagnostics: options.diagnostics ?? false };
}

function configurationConflict(key: string, actual: unknown, expected: string): Error {
  return diagnostic('CONFIG_VITE_CONFLICT', `Vite option "${key}" is ${displayValue(actual)}, but the Shopify theme plugin requires ${expected}. Remove "${key}" from the user config and let the plugin set it.`);
}

export function viteConfig(options: NormalizedOptions, user: UserConfig, aggregateCss = false): UserConfig {
  if (user.appType !== undefined && user.appType !== 'custom') throw configurationConflict('appType', user.appType, '`"custom"`');
  if (user.base !== undefined && user.base !== './') throw configurationConflict('base', user.base, 'the relative base `"./"`');
  if (user.publicDir !== undefined && user.publicDir !== false) throw configurationConflict('publicDir', user.publicDir, '`false`');
  if (user.input !== undefined) throw configurationConflict('input', user.input, 'the explicit entries supplied to `shopifyTheme()`');
  if (user.build?.outDir !== undefined) throw configurationConflict('build.outDir', user.build.outDir, 'the theme `assets` directory');
  if (user.build?.emptyOutDir === true) throw configurationConflict('build.emptyOutDir', true, '`false` so manual Shopify assets are preserved');
  if (user.build?.manifest !== undefined) throw configurationConflict('build.manifest', user.build.manifest, `the plugin manifest name ${JSON.stringify(VITE_MANIFEST)}`);
  if (user.build?.rolldownOptions?.input !== undefined) throw configurationConflict('build.rolldownOptions.input', user.build.rolldownOptions.input, 'the top-level plugin-owned `input`');
  const server = options.devOrigin ? {
    cors: { origin: options.devOrigin.origin },
    allowedHosts: [options.devOrigin.hostname],
    ws: { protocol: 'wss' as const, host: options.devOrigin.hostname, clientPort: Number(options.devOrigin.port || 443) },
  } : undefined;
  if (aggregateCss && CSS_BUNDLE_ENTRY in options.entries && !isStyleEntry(options.entries[CSS_BUNDLE_ENTRY])) {
    throw diagnostic('CONFIG_CSS_ENTRY_RESERVED', `Liquid entry name "${CSS_BUNDLE_ENTRY}" is reserved for the aggregated stylesheet when build.cssCodeSplit is false. Rename that non-stylesheet entry and retry.`);
  }
  const buildEntries = aggregateCss
    ? Object.fromEntries([
      ...Object.entries(options.entries).filter(([, path]) => !isStyleEntry(path)),
      [CSS_BUNDLE_ENTRY, CSS_BUNDLE_ID],
    ])
    : { ...options.entries };
  const assets = canonicalPathInside(options.themeRoot, resolve(options.themeRoot, 'assets'), 'Shopify assets directory');
  return {
    root: options.themeRoot, appType: 'custom', base: './', publicDir: false,
    input: buildEntries, server,
    build: {
      outDir: assets, emptyOutDir: false, manifest: VITE_MANIFEST,
      // Vite 8.0 reads build inputs here; later Vite 8 releases read the
      // top-level input above. Supplying the same owned map in both places is
      // harmless after the migration and keeps the declared minimum working.
      rolldownOptions: { input: buildEntries, output: { entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js', assetFileNames: '[name]-[hash][extname]' } },
    },
  };
}
