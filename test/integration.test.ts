import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shopifyTheme } from '../src/index.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'shopify-theme-integration-'));
  roots.push(root);
  mkdirSync(join(root, 'frontend'), { recursive: true });
  mkdirSync(join(root, 'snippets'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'frontend/theme.ts'), "import './shared.css'; console.log('theme')");
  writeFileSync(join(root, 'frontend/theme.css'), '.entry { color: red }');
  writeFileSync(join(root, 'frontend/theme.pcss'), '.pcss-entry { color: green }');
  writeFileSync(join(root, 'frontend/admin.postcss'), '.postcss-entry { color: purple }');
  writeFileSync(join(root, 'frontend/shared.css'), '.shared { color: blue }');
  writeFileSync(join(root, 'snippets/vite-tag.liquid'), 'original production snippet\n');
  writeFileSync(join(root, 'assets/manual.svg'), '<svg/>');
  return realpathSync.native(root);
}

const entries = { 'theme.css': 'frontend/theme.css', 'theme.ts': 'frontend/theme.ts' };
const statePath = (root: string) => join(root, '.vite-shopify-theme.json');
const snippetPath = (root: string) => join(root, 'snippets/vite-tag.liquid');
const lockPath = (root: string) => join(root, '.vite-shopify-theme.lock');

async function buildTheme(root: string, extraPlugins: any[] = [], buildOptions: Record<string, unknown> = {}) {
  return build({ configFile: false, root, logLevel: 'silent', build: buildOptions, plugins: [shopifyTheme({ entries, themeRoot: root }), ...extraPlugins] });
}

const postcssEntries = {
  'theme.pcss': 'frontend/theme.pcss',
  'admin.postcss': 'frontend/admin.postcss',
  'theme.ts': 'frontend/theme.ts',
};

async function buildPostcssTheme(root: string, buildOptions: Record<string, unknown> = {}) {
  return build({ configFile: false, root, logLevel: 'silent', build: buildOptions, plugins: [shopifyTheme({ entries: postcssEntries, themeRoot: root })] });
}

function devServer(root: string, devOrigin?: string, configuredEntries: Record<string, string> = entries, diagnostics = false) {
  const plugin = shopifyTheme({ entries: configuredEntries, themeRoot: root, devOrigin, diagnostics }) as any;
  const contribution = plugin.config({ root }, { command: 'serve', mode: 'development' });
  const info = vi.fn();
  const warn = vi.fn();
  plugin.configResolved({ command: 'serve', logger: { info, warn } });
  const httpServer = new EventEmitter() as EventEmitter & { address(): { address: string; family: string; port: number } };
  httpServer.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 5173 });
  const server = { config: { server: { host: '127.0.0.1', https: false, ...contribution.server } }, httpServer };
  plugin.configureServer(server);
  return { plugin, contribution, httpServer, info, warn };
}

describe('isolated builds', () => {
  it('emits opt-in build output and ownership diagnostics', () => {
    const root = fixture();
    const plugin = shopifyTheme({ entries, themeRoot: root, diagnostics: true }) as any;
    plugin.config({ root }, { command: 'build', mode: 'production' });
    const info = vi.fn();
    plugin.configResolved({ command: 'build', build: { modulePreload: true }, logger: { info, warn: vi.fn() } });
    plugin.buildStart();
    writeFileSync(join(root, 'assets/vite-manifest.json'), JSON.stringify({
      'frontend/theme.css': { file: 'theme.css', isEntry: true },
      'frontend/theme.ts': { file: 'theme.js', isEntry: true },
    }));
    plugin.writeBundle({}, { 'theme.css': {}, 'theme.js': {}, 'vite-manifest.json': {} });
    plugin.closeBundle();
    plugin.closeBundle();
    expect(info.mock.calls.flat()).toEqual([
      expect.stringMatching(/^\[shopify-theme:diagnostic:CONFIG_RESOLVED\] command=build /),
      expect.stringMatching(/^\[shopify-theme:diagnostic:OWNERSHIP_ACQUIRED\] mode=build /),
      '[shopify-theme:diagnostic:BUILD_OUTPUT_WRITTEN] assets=2 removed=0 snippet=snippets/vite-tag.liquid',
      expect.stringMatching(/^\[shopify-theme:diagnostic:OWNERSHIP_RELEASED\] mode=build /),
    ]);
  });

  it('builds explicit .pcss and .postcss entries as CSS assets and Liquid stylesheets', async () => {
    const root = fixture();
    await buildPostcssTheme(root);
    const manifest = JSON.parse(readFileSync(join(root, 'assets/vite-manifest.json'), 'utf8')) as Record<string, { file: string }>;
    expect(manifest['frontend/theme.pcss']?.file).toMatch(/\.css$/);
    expect(manifest['frontend/admin.postcss']?.file).toMatch(/\.css$/);
    const snippet = readFileSync(snippetPath(root), 'utf8');
    expect(snippet).toContain("{% when 'theme.pcss' %}");
    expect(snippet).toContain(`{{ '${manifest['frontend/theme.pcss'].file}' | asset_url }}`);
    expect(snippet).toContain("{% when 'admin.postcss' %}");
    expect(snippet).toContain(`{{ '${manifest['frontend/admin.postcss'].file}' | asset_url }}`);
    const themeBranch = snippet.slice(snippet.indexOf("{% when 'theme.pcss' %}"), snippet.indexOf("{% when 'admin.postcss' %}"));
    const adminBranch = snippet.slice(snippet.indexOf("{% when 'admin.postcss' %}"), snippet.indexOf("{% when 'theme.ts' %}"));
    expect(themeBranch).not.toContain('type="module"');
    expect(adminBranch).not.toContain('type="module"');
  });

  it('aggregates explicit .pcss and .postcss entries when CSS splitting is disabled', async () => {
    const root = fixture();
    await buildPostcssTheme(root, { cssCodeSplit: false });
    const manifest = JSON.parse(readFileSync(join(root, 'assets/vite-manifest.json'), 'utf8')) as Record<string, { file: string }>;
    expect(manifest['style.css']?.file).toMatch(/\.css$/);
    const css = readFileSync(join(root, 'assets', manifest['style.css'].file), 'utf8');
    expect(css).toContain('.pcss-entry');
    expect(css).toContain('.postcss-entry');
    const snippet = readFileSync(snippetPath(root), 'utf8');
    expect(snippet.match(new RegExp(manifest['style.css'].file.replaceAll('.', '\\.'), 'g'))).toHaveLength(3);
  });

  it('aggregates explicit CSS entries without emitting a JavaScript shim', async () => {
    const root = fixture();
    await buildTheme(root, [], { cssCodeSplit: false, modulePreload: false });
    const manifest = JSON.parse(readFileSync(join(root, 'assets/vite-manifest.json'), 'utf8')) as Record<string, { file: string }>;
    expect(manifest['style.css']?.file).toMatch(/\.css$/);
    const snippet = readFileSync(snippetPath(root), 'utf8');
    expect(snippet.match(new RegExp(manifest['style.css'].file.replaceAll('.', '\\.'), 'g'))).toHaveLength(2);
    expect(snippet).not.toContain('modulepreload');
    const state = JSON.parse(readFileSync(statePath(root), 'utf8')) as { files: string[] };
    expect(state.files.some((file) => file.startsWith('style-') && file.endsWith('.js'))).toBe(false);
    expect(existsSync(join(root, 'assets/manual.svg'))).toBe(true);
  });

  it('reports a missing aggregated CSS manifest asset', () => {
    const root = fixture();
    const plugin = shopifyTheme({ entries, themeRoot: root }) as any;
    plugin.config({ root, build: { cssCodeSplit: false } }, { command: 'build', mode: 'production' });
    plugin.configResolved({ command: 'build', build: { modulePreload: true } });
    plugin.buildStart();
    writeFileSync(join(root, 'assets/vite-manifest.json'), JSON.stringify({
      'frontend/theme.ts': { file: 'theme.js', isEntry: true },
    }));
    expect(() => plugin.writeBundle({}, {})).toThrow(/^\[shopify-theme:BUILD_CSS_MISSING\].*aggregated CSS asset.*manifest entry "style\.css".*clean build/i);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe('original production snippet\n');
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it('preserves manual assets, removes only stale owned files, and writes deterministic atomic state', async () => {
    const root = fixture();
    writeFileSync(join(root, 'assets/stale.js'), 'stale');
    writeFileSync(statePath(root), `${JSON.stringify({ files: ['stale.js'] }, null, 2)}\n`);
    chmodSync(snippetPath(root), 0o640);
    await buildTheme(root);
    expect(existsSync(join(root, 'assets/manual.svg'))).toBe(true);
    expect(existsSync(join(root, 'assets/stale.js'))).toBe(false);
    if (process.platform !== 'win32') expect(statSync(snippetPath(root)).mode & 0o777).toBe(0o640);
    const firstState = readFileSync(statePath(root), 'utf8');
    const firstSnippet = readFileSync(snippetPath(root), 'utf8');
    await buildTheme(root);
    expect(readFileSync(statePath(root), 'utf8')).toBe(firstState);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(firstSnippet);
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(readdirSync(join(root, 'snippets')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it('cleans a high-volume recorded set without touching unrecorded assets', async () => {
    const root = fixture();
    const stale = Array.from({ length: 1_500 }, (_, index) => `stale-${index}.js`);
    for (const file of stale) writeFileSync(join(root, 'assets', file), file);
    writeFileSync(join(root, 'assets', 'manual-unrecorded.js'), 'keep');
    writeFileSync(statePath(root), `${JSON.stringify({ files: stale }, null, 2)}\n`);
    await buildTheme(root);
    expect(stale.some((file) => existsSync(join(root, 'assets', file)))).toBe(false);
    expect(readFileSync(join(root, 'assets', 'manual-unrecorded.js'), 'utf8')).toBe('keep');
    expect(readFileSync(snippetPath(root), 'utf8')).toContain('Generated by vite-plugin-shopify-theme');
  });

  it('rejects an assets-directory symlink that escapes the canonical theme root', async () => {
    const root = fixture();
    const outside = mkdtempSync(join(tmpdir(), 'shopify-theme-assets-outside-'));
    roots.push(outside);
    writeFileSync(join(outside, 'manual.txt'), 'outside');
    rmSync(join(root, 'assets'), { recursive: true });
    symlinkSync(outside, join(root, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(buildTheme(root)).rejects.toThrow(/Shopify assets directory.*outside canonical theme root/i);
    expect(readFileSync(join(outside, 'manual.txt'), 'utf8')).toBe('outside');
    expect(readFileSync(snippetPath(root), 'utf8')).toBe('original production snippet\n');
  });

  it('builds through an assets-directory symlink whose target remains inside the theme', async () => {
    const root = fixture();
    const target = join(root, 'generated-assets');
    rmSync(join(root, 'assets'), { recursive: true });
    mkdirSync(target);
    writeFileSync(join(target, 'manual.svg'), '<svg/>');
    symlinkSync(target, join(root, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
    await buildTheme(root);
    expect(existsSync(join(target, 'vite-manifest.json'))).toBe(true);
    expect(readFileSync(join(target, 'manual.svg'), 'utf8')).toBe('<svg/>');
  });

  it('keeps the last successful assets and snippet after a failed build', async () => {
    const root = fixture();
    await buildTheme(root);
    const state = JSON.parse(readFileSync(statePath(root), 'utf8')) as { files: string[] };
    const snippet = readFileSync(snippetPath(root), 'utf8');
    const files = state.files.map((file) => [file, readFileSync(join(root, 'assets', file), 'utf8')] as const);
    const fail = { name: 'intentional-failure', transform() { throw new Error('intentional build failure'); } };
    await expect(buildTheme(root, [fail])).rejects.toThrow(/intentional build failure/);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(snippet);
    for (const [file, content] of files) expect(readFileSync(join(root, 'assets', file), 'utf8')).toBe(content);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['invalid structure', JSON.stringify({ files: 'stale.js' })],
    ['non-flat asset names', JSON.stringify({ files: ['nested/stale.js'] })],
  ])('fails safely for %s in generated ownership state', async (_case, state) => {
    const root = fixture();
    const originalSnippet = readFileSync(snippetPath(root), 'utf8');
    writeFileSync(statePath(root), state);
    await expect(buildTheme(root)).rejects.toThrow(/\[shopify-theme:(FS_JSON_INVALID|STATE_INVALID)\].*(parse.*ownership state|ownership state.*invalid structure)/i);
    expect(readFileSync(statePath(root), 'utf8')).toBe(state);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(originalSnippet);
    expect(existsSync(join(root, 'assets/manual.svg'))).toBe(true);
    expect(existsSync(lockPath(root))).toBe(false);
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reports invalid Vite manifest content and releases build ownership', () => {
    const root = fixture();
    const plugin = shopifyTheme({ entries, themeRoot: root }) as any;
    plugin.config({ root }, { command: 'build', mode: 'production' });
    plugin.configResolved({ command: 'build' });
    plugin.buildStart();
    writeFileSync(join(root, 'assets/vite-manifest.json'), JSON.stringify({ 'frontend/theme.ts': { file: 42 } }));
    expect(() => plugin.writeBundle({}, {})).toThrow(/manifest entry.*frontend\/theme\.ts.*invalid.*clean Vite build/i);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe('original production snippet\n');
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it('reports stale asset cleanup failures without committing new ownership state', async () => {
    const root = fixture();
    mkdirSync(join(root, 'assets/stale.js'));
    const state = `${JSON.stringify({ files: ['stale.js'] }, null, 2)}\n`;
    writeFileSync(statePath(root), state);
    await expect(buildTheme(root)).rejects.toThrow(/remove stale plugin-owned asset.*stale\.js.*ownership and permissions/i);
    expect(readFileSync(statePath(root), 'utf8')).toBe(state);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe('original production snippet\n');
    expect(statSync(join(root, 'assets/stale.js')).isDirectory()).toBe(true);
    expect(existsSync(lockPath(root))).toBe(false);
    expect(readdirSync(join(root, 'snippets')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('development ownership and recovery', () => {
  it('emits ordered opt-in lifecycle diagnostics without duplicate cleanup', () => {
    const root = fixture();
    const server = devServer(root, undefined, entries, true);
    expect(server.info.mock.calls.flat()).toEqual([
      expect.stringMatching(/^\[shopify-theme:diagnostic:CONFIG_RESOLVED\] command=serve /),
      expect.stringMatching(/^\[shopify-theme:diagnostic:OWNERSHIP_ACQUIRED\] mode=development /),
    ]);
    server.httpServer.emit('listening');
    server.plugin.handleHotUpdate({ file: join(root, 'templates/index.liquid'), server: { ws: { send: vi.fn() } } });
    server.plugin.closeServer();
    server.plugin.closeServer();
    expect(server.info.mock.calls.flat()).toEqual([
      expect.stringMatching(/^\[shopify-theme:diagnostic:CONFIG_RESOLVED\]/),
      expect.stringMatching(/^\[shopify-theme:diagnostic:OWNERSHIP_ACQUIRED\]/),
      expect.stringMatching(/^\[shopify-theme:diagnostic:DEVELOPMENT_ACTIVATED\]/),
      expect.stringMatching(/^\[shopify-theme\] Development assets ready/),
      expect.stringMatching(/^\[shopify-theme:diagnostic:HOT_RELOAD\] file=templates\/index\.liquid$/),
      expect.stringMatching(/^\[shopify-theme:diagnostic:DEVELOPMENT_RESTORED\]/),
      expect.stringMatching(/^\[shopify-theme:diagnostic:OWNERSHIP_RELEASED\] mode=development /),
    ]);
  });

  it('owns before listening, restores on close, and supports restart', () => {
    const root = fixture();
    const original = readFileSync(snippetPath(root), 'utf8');
    const first = devServer(root);
    expect(first.info).not.toHaveBeenCalled();
    expect(first.warn).not.toHaveBeenCalled();
    expect(existsSync(lockPath(root))).toBe(true);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(original);
    first.httpServer.emit('listening');
    expect(first.info).toHaveBeenCalledExactlyOnceWith('[shopify-theme] Development assets ready at http://127.0.0.1:5173 (2 entries; snippet: snippets/vite-tag.liquid).');
    expect(first.warn).not.toHaveBeenCalled();
    expect(readFileSync(snippetPath(root), 'utf8')).toContain('http://127.0.0.1:5173/@vite/client');
    first.plugin.closeServer();
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(original);
    expect(existsSync(lockPath(root))).toBe(false);

    const restarted = devServer(root, 'https://vite.example.test');
    expect(restarted.warn).not.toHaveBeenCalled();
    restarted.httpServer.emit('listening');
    expect(restarted.info).toHaveBeenCalledExactlyOnceWith('[shopify-theme] Development assets ready at https://vite.example.test (2 entries; snippet: snippets/vite-tag.liquid).');
    expect(restarted.warn).toHaveBeenCalledExactlyOnceWith('[shopify-theme:DEV_EXTERNAL_ORIGIN] External development origin https://vite.example.test must use HTTPS and remain stable. You are responsible for keeping an HTTP and WebSocket tunnel running; the plugin configures Vite but does not create or manage the tunnel.');
    expect(restarted.contribution.server.ws).toMatchObject({ protocol: 'wss', host: 'vite.example.test', clientPort: 443 });
    restarted.httpServer.emit('close');
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(original);
  });

  it('uses singular entry grammar and a normalized relative snippet path', () => {
    const root = fixture();
    const server = devServer(root, 'https://vite.example.test', { 'theme.ts': 'frontend/theme.ts' });
    server.httpServer.emit('listening');
    expect(server.info).toHaveBeenCalledExactlyOnceWith('[shopify-theme] Development assets ready at https://vite.example.test (1 entry; snippet: snippets/vite-tag.liquid).');
    server.plugin.closeServer();
  });

  it('rejects live development/build contention with an actionable diagnostic', async () => {
    const root = fixture();
    const active = devServer(root);
    expect(() => devServer(root)).toThrow(new RegExp(`^\\[shopify-theme:LOCK_ACTIVE\\].*development process ${process.pid}`));
    await expect(buildTheme(root)).rejects.toThrow(new RegExp(`\\[shopify-theme:LOCK_ACTIVE\\].*development process ${process.pid}`));
    active.plugin.closeServer();
  });

  it('recovers a dead owner only when the temporary snippet hash still matches', () => {
    const root = fixture();
    const original = readFileSync(snippetPath(root), 'utf8');
    const temporary = 'stale development snippet\n';
    writeFileSync(snippetPath(root), temporary);
    writeStaleLock(root, temporary, original, 'dead');
    const recovered = devServer(root);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(original);
    recovered.plugin.closeServer();

    writeFileSync(snippetPath(root), 'manual edit\n');
    writeStaleLock(root, temporary, original, 'dead-again');
    const preserved = devServer(root);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe('manual edit\n');
    preserved.plugin.closeServer();
  });

  it('handles repeated matched and mismatched crash recovery without losing manual snippets', () => {
    const root = fixture();
    const original = readFileSync(snippetPath(root), 'utf8');
    for (let index = 0; index < 20; index += 1) {
      const temporary = `stale development snippet ${index}\n`;
      const expected = index % 2 === 0 ? original : `manual edit ${index}\n`;
      writeFileSync(snippetPath(root), index % 2 === 0 ? temporary : expected);
      writeStaleLock(root, temporary, original, `dead-${index}`);
      const recovered = devServer(root);
      expect(readFileSync(snippetPath(root), 'utf8')).toBe(expected);
      recovered.plugin.closeServer();
      expect(existsSync(lockPath(root))).toBe(false);
    }
  });

  it.each([
    ['missing metadata', undefined],
    ['malformed metadata', '{not-json'],
    ['invalid metadata', JSON.stringify({ token: 'incomplete' })],
  ])('preserves a lock with %s and explains manual recovery', (_case, metadata) => {
    const root = fixture();
    mkdirSync(lockPath(root));
    if (metadata !== undefined) writeFileSync(join(lockPath(root), 'owner.json'), metadata);
    expect(() => devServer(root)).toThrow(/ownership.*(missing metadata|read or parsed|invalid structure).*confirming no Vite process.*remove the lock/i);
    expect(existsSync(lockPath(root))).toBe(true);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe('original production snippet\n');
  });

  it('rejects a non-directory snippet parent before taking startup ownership', () => {
    const root = fixture();
    writeFileSync(join(root, 'blocked'), 'not a directory');
    const plugin = shopifyTheme({ entries, themeRoot: root, snippet: 'blocked/vite-tag.liquid', devOrigin: 'https://vite.example.test' }) as any;
    expect(() => plugin.config({ root }, { command: 'serve', mode: 'development' })).toThrow(/^\[shopify-theme:THEME_STRUCTURE_INVALID\].*configured snippet directory.*not a directory/i);
    expect(existsSync(lockPath(root))).toBe(false);
  });
});

function writeStaleLock(root: string, temporary: string, original: string, token: string) {
  mkdirSync(lockPath(root));
  writeFileSync(join(lockPath(root), 'owner.json'), JSON.stringify({
    token, pid: 999_999_999, mode: 'development', startedAt: '2020-01-01T00:00:00.000Z',
    development: {
      snippet: snippetPath(root), developmentHash: createHash('sha256').update(temporary).digest('hex'),
      original: { exists: true, content: original },
    },
  }));
}
