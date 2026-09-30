import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { collectManifestTags, developmentSnippet, normalizeOptions, productionSnippet, shopifyTheme } from '../src/index.js';
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

  it('rejects missing, duplicate, and out-of-root entries', () => {
    const root = fixture();
    expect(() => normalizeOptions({ entries: { app: 'missing.ts' } }, root)).toThrow(/does not exist/);
    expect(() => normalizeOptions({ entries: { a: 'frontend/theme.ts', b: 'frontend/theme.ts' } }, root)).toThrow(/Duplicate/);
    expect(() => normalizeOptions({ entries: { app: '../escape.ts' } }, root)).toThrow(/outside/);
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
      styles: ['shared-b.css', 'theme-a.css'],
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
  });

  it('keeps runtime clients separate from entry renders in development', () => {
    const root = fixture();
    const snippet = developmentSnippet('https://vite.example.test', { app: join(root, 'frontend/theme.ts') }, root);
    expect(snippet).toContain('https://vite.example.test/@vite/client');
    expect(snippet).toContain('https://vite.example.test/@id/__x00__virtual:shopify-theme-hot-reload');
    expect(snippet).toContain('https://vite.example.test/frontend/theme.ts');
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
