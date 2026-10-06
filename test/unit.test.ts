import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { collectManifestTags, developmentSnippet, normalizeOptions, productionSnippet, shopifyTheme } from '../src/index.js';
import { renderProductionSnippet } from '../src/snippets.js';
import { initialize, telemetryNotice } from '../src/cli/init.js';
import { parseInitArguments } from '../src/cli.js';
import { runDevelopment } from '../src/cli/dev.js';
import { EventEmitter } from 'node:events';
import type { Manifest } from 'vite';

describe('setup CLI', () => {
  function theme() {
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-init-'));
    for (const directory of ['assets', 'layout', 'snippets']) mkdirSync(join(root, directory));
    writeFileSync(join(root, 'layout/theme.liquid'), '<html><head></head><body>{{ content_for_layout }}</body></html>\n');
    return root;
  }

  it('parses documented flags and rejects unknown values', () => {
    expect(parseInitArguments(['theme', '--new', '--lang', 'js', '--package-manager', 'bun', '--no-tailwind', '--no-skills', '--yes'])).toEqual({
      directory: 'theme', mode: 'new', language: 'js', packageManager: 'bun', tailwind: false, skills: false, yes: true,
    });
    expect(() => parseInitArguments(['--lang', 'coffee'])).toThrow('--lang must be js or ts');
  });

  it('applies non-interactive defaults and installs skills project-locally', async () => {
    const root = theme();
    const calls: Array<[string, string[], string]> = [];
    const logs: string[] = [];
    await initialize({ yes: true, directory: root }, { version: '0.4.0', cwd: '/', run: (command, args, directory) => calls.push([command, args, directory]), log: (message) => logs.push(message) });
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain("import shopify from '@display-studio/vite-plugin-shopify-theme'");
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain('tailwindcss()');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('vite-shopify-theme dev');
    expect(readFileSync(join(root, 'layout/theme.liquid'), 'utf8')).toContain("entry: 'theme.ts'");
    expect(calls[0][0]).toBe('npm');
    expect(calls[0][1]).toContain('@display-studio/vite-plugin-shopify-theme@0.4.0');
    expect(calls[1]).toEqual(['npx', ['--yes', 'skills', 'add', 'Shopify/shopify-ai-toolkit', '--yes'], root]);
    expect(logs).toContain(telemetryNotice);
  });

  it('supports JS without Tailwind or skills and preserves an ambiguous layout', async () => {
    const root = theme();
    writeFileSync(join(root, 'layout/theme.liquid'), '<head></head><head></head><body></body>');
    const calls: string[] = [];
    const result = await initialize({ yes: true, directory: root, language: 'js', tailwind: false, skills: false, packageManager: 'pnpm' }, {
      version: '0.4.0', cwd: '/', run: (command) => calls.push(command), log: vi.fn(),
    });
    expect(existsSync(join(root, 'vite.config.js'))).toBe(true);
    expect(readFileSync(join(root, 'frontend/entrypoints/theme.css'), 'utf8')).not.toContain('tailwindcss');
    expect(readFileSync(join(root, 'layout/theme.liquid'), 'utf8')).toBe('<head></head><head></head><body></body>');
    expect(result.layoutInstructions).toContain("entry: 'theme.js'");
    expect(calls).toEqual(['pnpm']);
  });

  it('rejects invalid themes and incompatible files without changing them', async () => {
    const invalid = mkdtempSync(join(tmpdir(), 'shopify-theme-invalid-'));
    await expect(initialize({ yes: true, skills: false, directory: invalid }, { version: '0.4.0', cwd: '/', run: vi.fn() })).rejects.toThrow('Not a Shopify theme');
    const root = theme();
    writeFileSync(join(root, 'vite.config.ts'), 'manual\n');
    await expect(initialize({ yes: true, skills: false, directory: root }, { version: '0.4.0', cwd: '/', run: vi.fn() })).rejects.toThrow('Refusing to overwrite');
    expect(existsSync(join(root, 'frontend/entrypoints/theme.ts'))).toBe(false);
  });

  it('creates a missing target through Shopify before setup', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'shopify-theme-new-'));
    const root = join(parent, 'new-theme');
    const calls: string[][] = [];
    await initialize({ yes: true, skills: false, directory: root }, { version: '0.4.0', cwd: '/', run: (command, args) => {
      calls.push([command, ...args]);
      if (command === 'shopify') for (const directory of ['assets', 'layout', 'snippets']) mkdirSync(join(root, directory), { recursive: true });
    } });
    expect(calls[0]).toEqual(['shopify', 'theme', 'init', 'new-theme', '--path', parent, '--latest']);
  });
});

describe('development CLI', () => {
  it('starts Vite through Node, forwards arguments, and starts Shopify in the theme root', () => {
    const spawned: Array<{ command: string; args: unknown; options: any; child: any }> = [];
    const spawn = ((command: string, argsOrOptions: unknown, maybeOptions?: unknown) => {
      const child = Object.assign(new EventEmitter(), { killed: false, kill: vi.fn(function (this: any) { this.killed = true; }) });
      spawned.push({ command, args: maybeOptions ? argsOrOptions : undefined, options: maybeOptions ?? argsOrOptions, child });
      return child;
    }) as never;
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-dev-'));
    const signals = new Map<string, () => void>();
    const result = runDevelopment(['--host', '0.0.0.0'], { cwd: root, platform: 'linux', spawn, onSignal: (signal, handler) => signals.set(signal, handler) });
    expect(spawned[0].command).toBe(process.execPath);
    expect(spawned[0].args).toEqual([expect.stringContaining('vite/bin/vite.js'), '--host', '0.0.0.0']);
    expect(spawned[1]).toMatchObject({ command: 'shopify', args: ['theme', 'dev'], options: { cwd: root } });
    signals.get('SIGINT')?.();
    expect(result.children.every((child) => child.killed)).toBe(true);
  });

  it('uses a shell only for the Windows Shopify shim', () => {
    const calls: any[] = [];
    const spawn = ((...args: any[]) => {
      calls.push(args);
      return Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    }) as never;
    runDevelopment([], { platform: 'win32', spawn, onSignal: vi.fn() });
    expect(calls[0][2].shell).toBeUndefined();
    expect(calls[1][0]).toBe('shopify theme dev');
    expect(calls[1][1].shell).toBe(true);
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'shopify-theme-'));
  mkdirSync(join(root, 'frontend'), { recursive: true });
  mkdirSync(join(root, 'snippets'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'frontend/theme.ts'), 'export {}');
  writeFileSync(join(root, 'frontend/theme.css'), 'body{}');
  return realpathSync.native(root);
}

describe('option validation', () => {
  it('prefixes configuration diagnostics with a stable searchable code', () => {
    const root = fixture();
    expect(() => normalizeOptions({ entries: {} }, root)).toThrow(/^\[shopify-theme:CONFIG_ENTRIES\]/);
  });

  it('normalizes and validates optional diagnostic logging', () => {
    const root = fixture();
    expect(normalizeOptions({ entries: { app: 'frontend/theme.ts' } }, root).diagnostics).toBe(false);
    expect(normalizeOptions({ entries: { app: 'frontend/theme.ts' }, diagnostics: true }, root).diagnostics).toBe(true);
    expect(() => normalizeOptions({ entries: { app: 'frontend/theme.ts' }, diagnostics: 'yes' as never }, root)).toThrow(/^\[shopify-theme:CONFIG_DIAGNOSTICS\]/);
  });

  it('reports missing and non-directory Shopify output structure', () => {
    const missingAssets = fixture();
    rmSync(join(missingAssets, 'assets'), { recursive: true });
    expect(() => normalizeOptions({ entries: { app: 'frontend/theme.ts' } }, missingAssets)).toThrow(/^\[shopify-theme:THEME_STRUCTURE_INVALID\].*Shopify assets directory.*Create this directory.*themeRoot/);

    const fileAssets = fixture();
    rmSync(join(fileAssets, 'assets'), { recursive: true });
    writeFileSync(join(fileAssets, 'assets'), 'not a directory');
    expect(() => normalizeOptions({ entries: { app: 'frontend/theme.ts' } }, fileAssets)).toThrow(/^\[shopify-theme:THEME_STRUCTURE_INVALID\].*Shopify assets directory.*not a directory/);

    const missingSnippets = fixture();
    expect(() => normalizeOptions({ entries: { app: 'frontend/theme.ts' }, snippet: 'liquid/generated/vite.liquid' }, missingSnippets)).toThrow(/^\[shopify-theme:THEME_STRUCTURE_INVALID\].*configured snippet directory.*Create this directory/);

    const fileSnippets = fixture();
    writeFileSync(join(fileSnippets, 'liquid'), 'not a directory');
    expect(() => normalizeOptions({ entries: { app: 'frontend/theme.ts' }, snippet: 'liquid/vite.liquid' }, fileSnippets)).toThrow(/^\[shopify-theme:THEME_STRUCTURE_INVALID\].*configured snippet directory.*not a directory/);
  });

  it('accepts an existing custom snippet directory', () => {
    const root = fixture();
    mkdirSync(join(root, 'liquid/generated'), { recursive: true });
    expect(normalizeOptions({ entries: { app: 'frontend/theme.ts' }, snippet: 'liquid/generated/vite.liquid' }, root).snippet).toBe(join(root, 'liquid/generated/vite.liquid'));
  });

  it('normalizes valid entries and an HTTPS origin', () => {
    const root = fixture();
    const value = normalizeOptions({ entries: { 'theme.ts': 'frontend/theme.ts' }, devOrigin: 'https://theme.example.test' }, root);
    expect(value.devOrigin?.origin).toBe('https://theme.example.test');
  });

  it.each(['theme', 'theme.ts', 'theme.min.js', 'theme_2', 'theme-dark.css', '9-theme'])('accepts Liquid-safe entry name %s', (name) => {
    const root = fixture();
    expect(normalizeOptions({ entries: { [name]: 'frontend/theme.ts' } }, root).entries[name]).toBe(join(root, 'frontend/theme.ts'));
  });

  it.each(['', "theme'", 'theme\njs', 'theme/js', 'theme\\js', 'theme js', '{{ theme }}', '{% theme %}', '.theme', '-theme', '_theme'])(
    'rejects unsafe Liquid entry name %j', (name) => {
      const root = fixture();
      expect(() => normalizeOptions({ entries: { [name]: 'frontend/theme.ts' } }, root)).toThrow(/Liquid entry name.*invalid.*ASCII letters/);
    },
  );

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

  it('canonicalizes a symlinked root and permits only contained symlink targets', () => {
    const root = fixture();
    const parent = mkdtempSync(join(tmpdir(), 'shopify-theme-links-'));
    const alias = join(parent, 'theme');
    symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const contained = join(root, 'linked-frontend');
    symlinkSync(join(root, 'frontend'), contained, process.platform === 'win32' ? 'junction' : 'dir');
    const normalized = normalizeOptions({ themeRoot: alias, entries: { app: 'linked-frontend/theme.ts' } }, parent);
    expect(normalized.themeRoot).toBe(realpathSync.native(root));
    expect(normalized.entries.app).toBe(realpathSync.native(join(root, 'frontend/theme.ts')));

    const outside = mkdtempSync(join(tmpdir(), 'shopify-theme-outside-'));
    writeFileSync(join(outside, 'escape.ts'), 'export {}');
    symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => normalizeOptions({ themeRoot: root, entries: { app: 'escape/escape.ts' } })).toThrow(/outside canonical theme root/);
    symlinkSync(outside, join(root, 'escape-snippets'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => normalizeOptions({ themeRoot: root, snippet: 'escape-snippets/vite-tag.liquid', entries: { app: 'frontend/theme.ts' } })).toThrow(/outside canonical theme root/);
  });
});

describe('manifest rendering', () => {
  const manifest = {
    'frontend/theme.ts': { file: 'theme-a.js', isEntry: true, imports: ['_shared.js'], css: ['theme-a.css'] },
    '_shared.js': { file: 'shared-b.js', imports: ['_deep.js'], css: ['shared-b.css'] },
    '_deep.js': { file: 'deep-c.js', css: ['shared-b.css'] },
    'frontend/theme.css': { file: 'theme-d.css', isEntry: true },
  } satisfies Manifest;

  it('codes missing manifest entries without losing their context', () => {
    expect(() => collectManifestTags({}, ['frontend/missing.ts'])).toThrow(/^\[shopify-theme:MANIFEST_ENTRY_MISSING\].*frontend\/missing\.ts/);
  });

  it('walks imports recursively and deduplicates in deterministic dependency order', () => {
    expect(collectManifestTags(manifest, ['frontend/theme.ts'])).toEqual({
      preloads: ['deep-c.js', 'shared-b.js'],
      styles: ['theme-a.css', 'shared-b.css'],
      scripts: ['theme-a.js'],
    });
  });

  it('walks a large cyclic manifest iteratively with stable deduplication', () => {
    const large: Manifest = {};
    const count = 12_000;
    for (let index = 0; index < count; index += 1) {
      large[`chunk-${index}`] = {
        file: `chunk-${index}.js`,
        imports: index + 1 < count ? [`chunk-${index + 1}`] : ['chunk-0'],
        css: [`shared-${index % 17}.css`],
      };
    }
    large.entry = { file: 'entry.js', imports: ['chunk-0', 'chunk-6000'], css: ['entry.css'] };
    const first = collectManifestTags(large, ['entry']);
    expect(first.preloads).toHaveLength(count);
    expect(first.styles).toHaveLength(18);
    expect(new Set(first.styles).size).toBe(18);
    expect(collectManifestTags(large, ['entry'])).toEqual(first);
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

  it.each(['css', 'pcss', 'postcss', 'scss', 'sass', 'less', 'styl', 'stylus', 'module.scss', 'module.pcss', 'module.postcss', 'CSS'])(
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
  it('resolves a nested theme from the configured monorepo root', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'shopify-theme-workspace-'));
    const root = join(workspace, 'packages/store-theme');
    mkdirSync(join(root, 'frontend'), { recursive: true });
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, 'snippets'));
    writeFileSync(join(root, 'frontend/theme.ts'), 'export {}');
    const canonicalRoot = realpathSync.native(root);
    const plugin = shopifyTheme({ themeRoot: 'packages/store-theme', entries: { app: 'frontend/theme.ts' } }) as any;
    const contribution = plugin.config({ root: workspace }, { command: 'build', mode: 'production' });
    expect(contribution).toMatchObject({
      root: canonicalRoot,
      input: { app: join(canonicalRoot, 'frontend/theme.ts') },
      build: { outDir: join(canonicalRoot, 'assets') },
    });
  });

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

  it('aggregates .pcss and .postcss stylesheet inputs when CSS splitting is disabled', () => {
    const root = fixture();
    writeFileSync(join(root, 'frontend/theme.pcss'), '.pcss {}');
    writeFileSync(join(root, 'frontend/admin.postcss'), '.postcss {}');
    const plugin = shopifyTheme({ entries: {
      'theme.pcss': 'frontend/theme.pcss',
      'admin.postcss': 'frontend/admin.postcss',
    }, themeRoot: root }) as any;
    const contribution = plugin.config({ root, build: { cssCodeSplit: false } }, { command: 'build', mode: 'production' });
    expect(contribution.input).toEqual({ 'style.css': 'virtual:shopify-theme-css-bundle' });
    expect(plugin.load('\0virtual:shopify-theme-css-bundle')).toBe([
      `import ${JSON.stringify(join(root, 'frontend/theme.pcss'))};`,
      `import ${JSON.stringify(join(root, 'frontend/admin.postcss'))};`,
    ].join('\n'));
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
