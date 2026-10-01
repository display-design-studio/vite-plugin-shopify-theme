import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { collectManifestTags, developmentSnippet, normalizeOptions, productionSnippet, shopifyTheme } from '../src/index.js';
import { renderProductionSnippet } from '../src/snippets.js';
import type { Manifest } from 'vite';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'shopify-theme-'));
  mkdirSync(join(root, 'frontend'), { recursive: true });
  mkdirSync(join(root, 'snippets'));
  writeFileSync(join(root, 'frontend/theme.ts'), 'export {}');
  writeFileSync(join(root, 'frontend/theme.css'), 'body{}');
  return root;
}

describe('option validation', () => {
  it('normalizes valid entries and an HTTPS origin', () => {
    const root = fixture();
    const value = normalizeOptions({ entries: { 'theme.ts': 'frontend/theme.ts' }, devOrigin: 'https://theme.example.test' }, root);
    expect(value.devOrigin?.origin).toBe('https://theme.example.test');
  });

  it.each(['http://example.com', 'https://user@example.com', 'https://example.com/path', 'not a url'])(
    'rejects malformed or unsafe origin %s', (devOrigin) => {
      const root = fixture();
      expect(() => normalizeOptions({ entries: { app: 'frontend/theme.ts' }, devOrigin }, root)).toThrow(/HTTPS|valid/);
    },
  );

  it('preserves the original URL parsing failure as the diagnostic cause', () => {
    const root = fixture();
    let failure: unknown;
    try { normalizeOptions({ entries: { app: 'frontend/theme.ts' }, devOrigin: 'not a url' }, root); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBeInstanceOf(TypeError);
  });

  it('rejects missing, duplicate, and out-of-root entries', () => {
    const root = fixture();
    mkdirSync(join(root, 'frontend/folder'));
    expect(() => normalizeOptions({ entries: { app: 'missing.ts' } }, root)).toThrow(/Entry "app".*missing\.ts.*not found.*Create the file/);
    expect(() => normalizeOptions({ entries: { app: 'frontend/folder' } }, root)).toThrow(/Entry "app".*not a file.*source file/);
    expect(() => normalizeOptions({ entries: { a: 'frontend/theme.ts', b: 'frontend/theme.ts' } }, root)).toThrow(/Entry "b" duplicates.*distinct source/);
    expect(() => normalizeOptions({ entries: { app: '../escape.ts' } }, root)).toThrow(/Entry "app".*outside theme root.*inside the theme/);
  });
});

describe('manifest rendering', () => {
  const manifest = {
    'frontend/theme.ts': { file: 'theme-a.js', isEntry: true, imports: ['_shared.js'], css: ['theme-a.css'] },
    '_shared.js': { file: 'shared-b.js', imports: ['_deep.js'], css: ['shared-b.css'] },
    '_deep.js': { file: 'deep-c.js', css: ['shared-b.css'] },
    'frontend/theme.css': { file: 'theme-d.css', isEntry: true },
  } satisfies Manifest;

  it('walks imports recursively and deduplicates in deterministic dependency order', () => {
    expect(collectManifestTags(manifest, ['frontend/theme.ts'])).toEqual({
      preloads: ['deep-c.js', 'shared-b.js'],
      styles: ['theme-a.css', 'shared-b.css'],
      scripts: ['theme-a.js'],
    });
  });

  it('renders only declared entry branches with Shopify asset URLs', () => {
    const root = fixture();
    const snippet = productionSnippet(manifest, {
      'theme.ts': join(root, 'frontend/theme.ts'), 'theme.css': join(root, 'frontend/theme.css'),
    }, root);
    expect(snippet).toContain("{% when 'theme.ts' %}");
    expect(snippet).toContain("{{ 'shared-b.js' | asset_url }}");
    expect(snippet.match(/shared-b\.css/g)).toHaveLength(1);
    expect(snippet).toContain("{{ 'theme-d.css' | asset_url }}");
    const branch = snippet.slice(snippet.indexOf("{% when 'theme.ts' %}"), snippet.indexOf("{% when 'theme.css' %}"));
    expect(branch.indexOf('theme-a.css')).toBeLessThan(branch.indexOf('shared-b.css'));
    expect(branch.indexOf('shared-b.css')).toBeLessThan(branch.indexOf('theme-a.js'));
    expect(branch.indexOf('theme-a.js')).toBeLessThan(branch.indexOf('deep-c.js'));
  });

  it('honors disabled module preloads without changing scripts or styles', () => {
    const root = fixture();
    const snippet = renderProductionSnippet(manifest, { 'theme.ts': join(root, 'frontend/theme.ts') }, root, { modulePreload: false });
    expect(snippet).toContain("{{ 'theme-a.css' | asset_url }}");
    expect(snippet).toContain("{{ 'theme-a.js' | asset_url }}");
    expect(snippet).not.toContain('modulepreload');
  });

  it('includes aggregated CSS exactly once in every branch', () => {
    const root = fixture();
    const snippet = renderProductionSnippet(manifest, {
      'theme.ts': join(root, 'frontend/theme.ts'), 'theme.css': join(root, 'frontend/theme.css'),
    }, root, { modulePreload: true, aggregateCss: 'style-z.css' });
    expect(snippet.match(/style-z\.css/g)).toHaveLength(2);
    expect(snippet).not.toContain('theme-d.css');
    for (const branch of snippet.split('{% when ').slice(1)) expect(branch.match(/style-z\.css/g)).toHaveLength(1);
  });

  it('keeps runtime clients separate from entry renders in development', () => {
    const root = fixture();
    const snippet = developmentSnippet('https://vite.example.test', { app: join(root, 'frontend/theme.ts') }, root);
    expect(snippet).toContain('https://vite.example.test/@vite/client');
    expect(snippet).toContain('https://vite.example.test/@id/__x00__virtual:shopify-theme-hot-reload');
    expect(snippet).toContain('https://vite.example.test/frontend/theme.ts');
    expect(snippet.match(/crossorigin="anonymous"/g)).toHaveLength(3);
  });

  it.each(['css', 'scss', 'sass', 'less', 'styl', 'stylus', 'module.scss', 'CSS'])(
    'renders .%s entries as stylesheets in development', (extension) => {
      const root = fixture();
      const path = join(root, `frontend/theme.${extension}`);
      const snippet = developmentSnippet('https://vite.example.test', { theme: path }, root);
      expect(snippet).toContain(`<link rel="stylesheet" href="https://vite.example.test/frontend/theme.${extension}" crossorigin="anonymous">`);
      expect(snippet).not.toContain(`<script type="module" src="https://vite.example.test/frontend/theme.${extension}"`);
    },
  );
});

describe('Vite 8 configuration', () => {
  it('owns publicDir and top-level input and uses server.ws for tunnels', () => {
    const root = fixture();
    const plugin = shopifyTheme({ entries: { app: 'frontend/theme.ts' }, themeRoot: root, devOrigin: 'https://vite.example.test' }) as any;
    const contribution = plugin.config({ root }, { command: 'serve', mode: 'development' });
    expect(contribution).toMatchObject({ publicDir: false, input: { app: join(root, 'frontend/theme.ts') } });
    expect(contribution.build.rolldownOptions.input).toEqual({ app: join(root, 'frontend/theme.ts') });
    expect(contribution.server).toMatchObject({
      cors: { origin: 'https://vite.example.test' }, allowedHosts: ['vite.example.test'],
      ws: { protocol: 'wss', host: 'vite.example.test', clientPort: 443 },
    });
    expect(contribution.server.hmr).toBeUndefined();
  });

  it('replaces direct stylesheet inputs with one virtual input only when CSS splitting is disabled', () => {
    const root = fixture();
    const plugin = shopifyTheme({ entries: { 'theme.css': 'frontend/theme.css', app: 'frontend/theme.ts' }, themeRoot: root }) as any;
    const contribution = plugin.config({ root, build: { cssCodeSplit: false } }, { command: 'build', mode: 'production' });
    expect(contribution.input).toEqual({ app: join(root, 'frontend/theme.ts'), 'style.css': 'virtual:shopify-theme-css-bundle' });
    expect(plugin.resolveId('virtual:shopify-theme-css-bundle')).toBe('\0virtual:shopify-theme-css-bundle');
    expect(plugin.load('\0virtual:shopify-theme-css-bundle')).toBe(`import ${JSON.stringify(join(root, 'frontend/theme.css'))};`);
  });

  it('leaves development inputs unchanged when the shared config disables CSS splitting', () => {
    const root = fixture();
    const plugin = shopifyTheme({ entries: { 'theme.css': 'frontend/theme.css', app: 'frontend/theme.ts' }, themeRoot: root }) as any;
    const contribution = plugin.config({ root, build: { cssCodeSplit: false } }, { command: 'serve', mode: 'development' });
    expect(contribution.input).toEqual({ 'theme.css': join(root, 'frontend/theme.css'), app: join(root, 'frontend/theme.ts') });
    expect(plugin.resolveId('virtual:shopify-theme-css-bundle')).toBeUndefined();
  });

  it.each([
    [{ appType: 'spa' }, 'appType'], [{ base: '/' }, 'base'], [{ publicDir: 'public' }, 'publicDir'],
    [{ input: { other: 'frontend/theme.ts' } }, 'input'], [{ input: '' }, 'input'],
    [{ build: { outDir: 'dist' } }, 'build.outDir'], [{ build: { emptyOutDir: true } }, 'build.emptyOutDir'],
    [{ build: { manifest: false } }, 'build.manifest'],
    [{ build: { rolldownOptions: { input: 'frontend/theme.ts' } } }, 'build.rolldownOptions.input'],
  ] as const)('rejects plugin-owned configuration %#', (user, key) => {
    const root = fixture();
    const plugin = shopifyTheme({ entries: { app: 'frontend/theme.ts' }, themeRoot: root }) as any;
    expect(() => plugin.config({ root, ...user }, { command: 'build', mode: 'production' })).toThrow(new RegExp(`option "${key.replaceAll('.', '\\.') }".*Remove "${key.replaceAll('.', '\\.') }"`));
  });
});

describe('development updates', () => {
  it('serves the hot-reload endpoint and reloads after theme file changes', () => {
    const root = fixture();
    const plugin = shopifyTheme({ entries: { 'theme.css': 'frontend/theme.css' }, themeRoot: root }) as any;
    plugin.config({ root }, { command: 'serve', mode: 'development' });

    const resolved = plugin.resolveId('virtual:shopify-theme-hot-reload');
    expect(resolved).toBe('\0virtual:shopify-theme-hot-reload');
    expect(plugin.load(resolved)).toContain("import.meta.hot.on('vite:beforeFullReload', rememberReload)");
    expect(plugin.load(resolved)).toContain("import.meta.hot.on('shopify:theme-update'");
    expect(plugin.load(resolved)).toContain('sessionStorage.getItem(reloadKey)');

    const send = vi.fn();
    const modules = plugin.handleHotUpdate({ file: join(root, 'sections/hello-world.liquid'), server: { ws: { send } } });
    expect(send).toHaveBeenCalledWith({ type: 'custom', event: 'shopify:theme-update', data: {} });
    expect(modules).toEqual([]);
  });
});
