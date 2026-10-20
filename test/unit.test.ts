import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { normalizeOptions } from '../src/config.js';
import { shopifyTheme } from '../src/index.js';
import {
  collectManifestTags,
  developmentSnippet,
  productionSnippet,
  renderProductionSnippet,
  SNIPPET_SIZE_LIMIT,
  snippetSizeWarning,
} from '../src/snippets.js';
import { initialize } from '../src/cli/init.js';
import { parseInitArguments } from '../src/cli.js';
import { describeTarget, runDevelopment, shopifyThemeArguments } from '../src/cli/dev.js';
import {
  formatFooter,
  formatGitignoreHint,
  formatHeader,
  missingGeneratedPatterns,
  outputStyle,
} from '../src/cli/output.js';
import { formatBuildLine } from '../src/terminal.js';
import { EventEmitter } from 'node:events';
import type { Manifest } from 'vite';

describe('setup CLI', () => {
  function theme() {
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-init-'));
    for (const directory of ['assets', 'layout', 'snippets']) mkdirSync(join(root, directory));
    writeFileSync(
      join(root, 'layout/theme.liquid'),
      '<html><head></head><body>{{ content_for_layout }}</body></html>\n',
    );
    return root;
  }

  it('parses documented flags and rejects unknown values', () => {
    expect(
      parseInitArguments([
        'theme',
        '--new',
        '--lang',
        'js',
        '--package-manager',
        'bun',
        '--no-tailwind',
        '--no-skills',
        '--yes',
      ]),
    ).toEqual({
      directory: 'theme',
      mode: 'new',
      language: 'js',
      packageManager: 'bun',
      tailwind: false,
      yes: true,
    });
    expect(() => parseInitArguments(['--lang', 'coffee'])).toThrow('--lang must be js or ts');
    expect(() => parseInitArguments(['--lang'])).toThrow('--lang requires js or ts');
    expect(() => parseInitArguments(['--package-manager'])).toThrow('--package-manager requires');
    expect(() => parseInitArguments(['--tailwind', '--no-tailwind'])).toThrow('cannot be combined');
    expect(() => parseInitArguments(['--skills'])).toThrow('--skills was removed');
  });

  it('applies non-interactive defaults without installing skills', async () => {
    const root = theme();
    const calls: Array<[string, string[], string]> = [];
    const logs: string[] = [];
    await initialize(
      { yes: true, directory: root },
      {
        version: '0.4.0',
        cwd: '/',
        run: (command, args, directory) => calls.push([command, args, directory]),
        log: (message) => logs.push(message),
      },
    );
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain(
      "import shopify from '@display-studio/vite-plugin-shopify-theme'",
    );
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain('tailwindcss()');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('vite-shopify-theme dev');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).type).toBe('module');
    expect(readFileSync(join(root, 'layout/theme.liquid'), 'utf8')).toContain("entry: 'theme.ts'");
    expect(calls[0][0]).toBe('npm');
    expect(calls[0][1]).toContain('@display-studio/vite-plugin-shopify-theme@0.4.0');
    expect(calls).toHaveLength(1);
    expect(logs).toEqual([
      `Configured Shopify theme at ${root}`,
      expect.stringContaining('copy example.shopify.theme.toml to shopify.theme.toml'),
    ]);
  });

  it('supports JS without Tailwind and preserves an ambiguous layout', async () => {
    const root = theme();
    writeFileSync(join(root, 'layout/theme.liquid'), '<head></head><head></head><body></body>');
    const calls: string[] = [];
    const result = await initialize(
      { yes: true, directory: root, language: 'js', tailwind: false, packageManager: 'pnpm' },
      {
        version: '0.4.0',
        cwd: '/',
        run: (command) => calls.push(command),
        log: vi.fn(),
      },
    );
    expect(existsSync(join(root, 'vite.config.js'))).toBe(true);
    expect(readFileSync(join(root, 'frontend/entrypoints/theme.css'), 'utf8')).not.toContain('tailwindcss');
    expect(readFileSync(join(root, 'layout/theme.liquid'), 'utf8')).toBe('<head></head><head></head><body></body>');
    expect(result.layoutInstructions).toContain("entry: 'theme.js'");
    expect(calls).toEqual(['pnpm']);
  });

  it('rejects invalid themes and incompatible files without changing them', async () => {
    const invalid = mkdtempSync(join(tmpdir(), 'shopify-theme-invalid-'));
    await expect(
      initialize({ yes: true, directory: invalid }, { version: '0.4.0', cwd: '/', run: vi.fn() }),
    ).rejects.toThrow('Not a Shopify theme');
    const root = theme();
    mkdirSync(join(root, 'frontend/entrypoints'), { recursive: true });
    writeFileSync(join(root, 'frontend/entrypoints/theme.css'), 'manual\n');
    await expect(
      initialize({ yes: true, directory: root }, { version: '0.4.0', cwd: '/', run: vi.fn() }),
    ).rejects.toThrow('Refusing to overwrite');
    expect(existsSync(join(root, 'frontend/entrypoints/theme.ts'))).toBe(false);
    expect(existsSync(join(root, 'vite.config.ts'))).toBe(false);
  });

  it('creates a missing target through Shopify before setup', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'shopify-theme-new-'));
    const root = join(parent, 'new-theme');
    const calls: string[][] = [];
    await initialize(
      { yes: true, directory: root },
      {
        version: '0.4.0',
        cwd: '/',
        run: (command, args) => {
          calls.push([command, ...args]);
          if (command === 'shopify')
            for (const directory of ['assets', 'layout', 'snippets', '.git'])
              mkdirSync(join(root, directory), { recursive: true });
        },
      },
    );
    expect(existsSync(join(root, '.git'))).toBe(false);
    expect(calls[0]).toEqual([
      'shopify',
      'theme',
      'init',
      'new-theme',
      '--path',
      parent,
      '--clone-url',
      'https://github.com/Shopify/skeleton-theme.git#v1.0.0',
    ]);
  });

  it('creates a placeholder snippet but never replaces an existing one', async () => {
    const root = theme();
    await initialize({ yes: true, directory: root }, { version: '0.4.0', cwd: '/', run: vi.fn() });
    expect(readFileSync(join(root, 'snippets/vite-tag.liquid'), 'utf8')).toContain(
      'Placeholder created by vite-shopify-theme init',
    );
    const manual = theme();
    writeFileSync(join(manual, 'snippets/vite-tag.liquid'), 'manual\n');
    await initialize({ yes: true, directory: manual }, { version: '0.4.0', cwd: '/', run: vi.fn() });
    expect(readFileSync(join(manual, 'snippets/vite-tag.liquid'), 'utf8')).toBe('manual\n');
  });

  it('keeps the git repository of an existing theme', async () => {
    const root = theme();
    mkdirSync(join(root, '.git'));
    await initialize({ yes: true, directory: root }, { version: '0.4.0', cwd: '/', run: vi.fn() });
    expect(existsSync(join(root, '.git'))).toBe(true);
  });

  it('writes an example Shopify environment, never overwrites it, and ignores the local copy', async () => {
    const root = theme();
    writeFileSync(
      join(root, 'example.shopify.theme.toml'),
      '[environments.development]\nstore = "mine.myshopify.com"\n',
    );
    await initialize({ yes: true, directory: root }, { version: '0.5.0', cwd: '/', run: vi.fn() });
    expect(readFileSync(join(root, 'example.shopify.theme.toml'), 'utf8')).toContain('mine.myshopify.com');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toMatch(/^shopify\.theme\.toml$/m);
    const fresh = theme();
    await initialize({ yes: true, directory: fresh }, { version: '0.5.0', cwd: '/', run: vi.fn() });
    expect(readFileSync(join(fresh, 'example.shopify.theme.toml'), 'utf8')).toBe(
      '[environments.development]\nstore = "your-store.myshopify.com"\n',
    );
  });

  it('adds a dev:editor script without replacing one the project already defines', async () => {
    const root = theme();
    await initialize({ yes: true, directory: root }, { version: '0.5.2', cwd: '/', run: vi.fn() });
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['dev:editor']).toBe(
      'vite-shopify-theme dev --editor',
    );
    const custom = theme();
    writeFileSync(join(custom, 'package.json'), '{"scripts":{"dev:editor":"my-own"}}\n');
    await initialize({ yes: true, directory: custom }, { version: '0.5.2', cwd: '/', run: vi.fn() });
    expect(JSON.parse(readFileSync(join(custom, 'package.json'), 'utf8')).scripts['dev:editor']).toBe('my-own');
  });

  it('is idempotent and merges ignore files without duplicates', async () => {
    const root = theme();
    writeFileSync(join(root, '.gitignore'), 'coverage/\nnode_modules/\n');
    writeFileSync(join(root, '.shopifyignore'), 'sections/private.liquid\nfrontend/*\n');
    const runtime = { version: '0.4.0', cwd: '/', run: vi.fn() };
    const options = { yes: true, directory: root } as const;
    await initialize(options, runtime);
    const first = new Map(
      ['package.json', 'vite.config.ts', '.gitignore', '.shopifyignore', 'layout/theme.liquid'].map((file) => [
        file,
        readFileSync(join(root, file), 'utf8'),
      ]),
    );
    await initialize(options, runtime);
    for (const [file, contents] of first) expect(readFileSync(join(root, file), 'utf8')).toBe(contents);
    expect(readFileSync(join(root, '.gitignore'), 'utf8').match(/node_modules\//g)).toHaveLength(1);
    expect(readFileSync(join(root, '.shopifyignore'), 'utf8').match(/frontend\/\*/g)).toHaveLength(1);
  });

  it.each([
    ['npm', ['install', '--save-dev']],
    ['pnpm', ['add', '--save-dev']],
    ['yarn', ['add', '--dev']],
    ['bun', ['add', '--dev']],
  ] as const)('uses the %s development dependency command', async (packageManager, prefix) => {
    const root = theme();
    const run = vi.fn();
    await initialize(
      { yes: true, tailwind: false, language: 'js', directory: root, packageManager },
      { version: '0.4.0', cwd: '/', run },
    );
    expect(run.mock.calls[0][0]).toBe(packageManager);
    expect(run.mock.calls[0][1].slice(0, prefix.length)).toEqual(prefix);
  });

  it('rejects mode and script conflicts before writing generated files', async () => {
    const root = theme();
    await expect(
      initialize({ yes: true, mode: 'new', directory: root }, { version: '0.4.0', cwd: '/', run: vi.fn() }),
    ).rejects.toThrow('Target already exists');
    writeFileSync(join(root, 'package.json'), '{"scripts":{"dev":"custom-dev"}}\n');
    await expect(
      initialize({ yes: true, directory: root }, { version: '0.4.0', cwd: '/', run: vi.fn() }),
    ).rejects.toThrow('incompatible package script');
    expect(existsSync(join(root, 'vite.config.ts'))).toBe(false);
    expect(readFileSync(join(root, 'layout/theme.liquid'), 'utf8')).not.toContain('vite-tag');
  });

  it('runs interactive choices and confirms the summary', async () => {
    const root = theme();
    const run = vi.fn();
    const log = vi.fn();
    const confirmations = [false, true];
    await initialize(
      { directory: root },
      {
        version: '0.4.0',
        cwd: '/',
        run,
        log,
        select: vi.fn(async (question: string) => (question === 'Language' ? 'js' : 'yarn')) as never,
        confirm: vi.fn(async () => confirmations.shift() ?? false),
      },
    );
    expect(run.mock.calls[0][0]).toBe('yarn');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps an existing Vite setup and only adds the plugin, ignore patterns, and guidance', async () => {
    const root = theme();
    const config = "import { defineConfig } from 'vite';\nexport default defineConfig({ publicDir: 'public' });\n";
    const layout =
      "<html><head>{% render 'vite-tag' with 'main.css' %}</head><body>{% render 'vite-tag' with 'main.js' %}</body></html>\n";
    mkdirSync(join(root, 'frontend/entrypoints'), { recursive: true });
    writeFileSync(join(root, 'frontend/entrypoints/main.css'), 'body {}\n');
    writeFileSync(join(root, 'vite.config.js'), config);
    writeFileSync(join(root, 'layout/theme.liquid'), layout);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        type: 'module',
        scripts: { dev: 'run-p vite:dev shopify:dev', build: 'tsc && vite build' },
        devDependencies: { vite: '^8.3.1' },
      }),
    );
    const run = vi.fn();
    const logs: string[] = [];
    const result = await initialize(
      { yes: true, directory: root, packageManager: 'bun' },
      { version: '0.6.0', cwd: '/', run, log: (message) => logs.push(message) },
    );
    expect(result.adopted).toBe(true);
    expect(readFileSync(join(root, 'vite.config.js'), 'utf8')).toBe(config);
    expect(existsSync(join(root, 'vite.config.ts'))).toBe(false);
    expect(existsSync(join(root, 'frontend/entrypoints/theme.css'))).toBe(false);
    expect(existsSync(join(root, 'frontend/entrypoints/theme.ts'))).toBe(false);
    expect(readFileSync(join(root, 'layout/theme.liquid'), 'utf8')).toBe(layout);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(manifest.scripts).toEqual({
      'dev:editor': 'vite-shopify-theme dev --editor',
      dev: 'run-p vite:dev shopify:dev',
      build: 'tsc && vite build',
    });
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('assets/*-????????.js');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toEqual(['add', '--dev', '@display-studio/vite-plugin-shopify-theme@0.6.0']);
    const output = logs.join('\n');
    expect(output).toContain('Found an existing Vite config');
    expect(output).toContain('Package script "dev" was left unchanged: run-p vite:dev shopify:dev');
    expect(output).toContain('Package script "build" was left unchanged: tsc && vite build');
    expect(output).toContain("entry: 'theme.css'");
  });

  it('installs Vite for an existing config when the project does not declare it', async () => {
    const root = theme();
    writeFileSync(join(root, 'vite.config.mjs'), 'export default {};\n');
    const run = vi.fn();
    await initialize(
      { yes: true, directory: root, packageManager: 'npm' },
      { version: '0.6.0', cwd: '/', run, log: vi.fn() },
    );
    expect(run.mock.calls[0][1]).toEqual([
      'install',
      '--save-dev',
      'vite@^8.0.0',
      '@display-studio/vite-plugin-shopify-theme@0.6.0',
    ]);
  });

  it('adds only missing layout tags and preserves existing markup', async () => {
    const root = theme();
    writeFileSync(
      join(root, 'layout/theme.liquid'),
      "<html><head>\n  {% render 'vite-tag' %}\n</head><body>content</body></html>\n",
    );
    await initialize({ yes: true, directory: root }, { version: '0.4.0', cwd: '/', run: vi.fn() });
    const layout = readFileSync(join(root, 'layout/theme.liquid'), 'utf8');
    expect(layout.match(/render 'vite-tag'/g)).toHaveLength(3);
    expect(layout).toContain('<body>content');
  });
});

describe('development CLI', () => {
  it('starts Vite through Node, forwards arguments, and starts Shopify in the theme root once Vite is ready', async () => {
    const spawned: Array<{ command: string; args: unknown; options: any; child: any }> = [];
    const spawn = ((command: string, argsOrOptions: unknown, maybeOptions?: unknown) => {
      const child = Object.assign(new EventEmitter(), {
        killed: false,
        kill: vi.fn(function (this: any) {
          this.killed = true;
        }),
      });
      spawned.push({
        command,
        args: maybeOptions ? argsOrOptions : undefined,
        options: maybeOptions ?? argsOrOptions,
        child,
      });
      return child;
    }) as never;
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-dev-'));
    const signals = new Map<string, () => void>();
    let release!: (ready: boolean) => void;
    const ready = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const result = runDevelopment(['--host', '0.0.0.0'], {
      cwd: root,
      platform: 'linux',
      spawn,
      ready: () => ready,
      onSignal: (signal, handler) => signals.set(signal, handler),
    });
    expect(spawned).toHaveLength(1);
    release(true);
    await result.started;
    expect(spawned[0].command).toBe(process.execPath);
    expect(spawned[0].args).toEqual([
      expect.stringMatching(/vite[\\/]bin[\\/]vite\.js$/),
      '--host',
      '0.0.0.0',
      '--logLevel',
      'warn',
    ]);
    expect(spawned[1]).toMatchObject({ command: 'shopify', args: ['theme', 'dev'], options: { cwd: root } });
    // npm sets INIT_CWD to where the script was started; Shopify CLI must look in the directory `dev` runs in.
    expect(spawned[1].options.env.INIT_CWD).toBe(root);
    signals.get('SIGINT')?.();
    expect(result.children.every((child) => child.killed)).toBe(true);
  });

  it('sends arguments after -- to Shopify and keeps the rest for Vite', async () => {
    const calls: any[] = [];
    const spawn = ((...args: any[]) => {
      calls.push(args);
      return Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    }) as never;
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-dev-'));
    await runDevelopment(['--host', '--', '--theme', '123', '--store', 'x.myshopify.com'], {
      cwd: root,
      platform: 'linux',
      spawn,
      ready: async () => true,
      onSignal: vi.fn(),
    }).started;
    expect(calls[0][1]).toEqual([expect.stringMatching(/vite\.js$/), '--host', '--logLevel', 'warn']);
    expect(calls[1][1]).toEqual(['theme', 'dev', '--theme', '123', '--store', 'x.myshopify.com']);
  });

  it('runs a watched build and full-page reloads in editor mode', async () => {
    const calls: any[] = [];
    const spawn = ((...args: any[]) => {
      calls.push(args);
      return Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    }) as never;
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-dev-'));
    await runDevelopment(['--editor', '--mode', 'staging', '--', '--store', 'x.myshopify.com'], {
      cwd: root,
      platform: 'linux',
      spawn,
      ready: async () => true,
      onSignal: vi.fn(),
    }).started;
    expect(calls[0][1]).toEqual([
      expect.stringMatching(/vite\.js$/),
      'build',
      '--watch',
      '--mode',
      'staging',
      '--logLevel',
      'warn',
    ]);
    expect(calls[1][1]).toEqual(['theme', 'dev', '--live-reload', 'full-page', '--store', 'x.myshopify.com']);
  });

  it('lets the caller choose the live-reload mode in editor mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-env-'));
    expect(shopifyThemeArguments(root, [], {}, true)).toEqual(['theme', 'dev', '--live-reload', 'full-page']);
    expect(shopifyThemeArguments(root, ['--live-reload', 'hot-reload'], {}, true)).toEqual([
      'theme',
      'dev',
      '--live-reload',
      'hot-reload',
    ]);
    expect(shopifyThemeArguments(root, ['--live-reload=off'], {}, true)).toEqual(['theme', 'dev', '--live-reload=off']);
    expect(shopifyThemeArguments(root, [], { SHOPIFY_FLAG_LIVE_RELOAD: 'off' }, true)).toEqual(['theme', 'dev']);
    expect(shopifyThemeArguments(root, [], {}, false)).toEqual(['theme', 'dev']);
  });

  it('selects the development environment from shopify.theme.toml unless one is already chosen', () => {
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-env-'));
    expect(shopifyThemeArguments(root, [], {})).toEqual(['theme', 'dev']);
    writeFileSync(join(root, 'shopify.theme.toml'), '[environments.staging]\nstore = "s"\n');
    expect(shopifyThemeArguments(root, [], {})).toEqual(['theme', 'dev']);
    writeFileSync(join(root, 'shopify.theme.toml'), '# local\n[environments.development]\nstore = "d.myshopify.com"\n');
    expect(shopifyThemeArguments(root, [], {})).toEqual(['theme', 'dev', '--environment', 'development']);
    expect(shopifyThemeArguments(root, ['--live-reload', 'full-page'], {})).toEqual([
      'theme',
      'dev',
      '--environment',
      'development',
      '--live-reload',
      'full-page',
    ]);
    expect(shopifyThemeArguments(root, ['-e', 'staging'], {})).toEqual(['theme', 'dev', '-e', 'staging']);
    expect(shopifyThemeArguments(root, ['--environment=staging'], {})).toEqual([
      'theme',
      'dev',
      '--environment=staging',
    ]);
    expect(shopifyThemeArguments(root, [], { SHOPIFY_FLAG_ENVIRONMENT: 'staging' })).toEqual(['theme', 'dev']);
  });

  it('points Shopify CLI at the directory dev runs in, not where npm started the script, and keeps an explicit path', async () => {
    for (const platform of ['linux', 'win32'] as const) {
      const calls: any[] = [];
      const spawn = ((...args: any[]) => {
        calls.push(args);
        return Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
      }) as never;
      const root = mkdtempSync(join(tmpdir(), 'shopify-theme-dev-'));
      await runDevelopment([], {
        cwd: root,
        platform,
        spawn,
        ready: async () => true,
        onSignal: vi.fn(),
        env: { INIT_CWD: '/workspace-root', SHOPIFY_FLAG_PATH: '/explicit/theme' },
      }).started;
      const options = calls[1].at(-1);
      expect(options.env.INIT_CWD, platform).toBe(root);
      expect(options.env.SHOPIFY_FLAG_PATH, platform).toBe('/explicit/theme');
    }
  });

  it('runs Vite at the warn level under the command, unless --raw or the caller chose a level', async () => {
    const start = async (argumentsList: string[]) => {
      const calls: any[] = [];
      const spawn = ((...args: any[]) => {
        calls.push(args);
        return Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
      }) as never;
      const root = mkdtempSync(join(tmpdir(), 'shopify-theme-dev-'));
      await runDevelopment(argumentsList, {
        cwd: root,
        platform: 'linux',
        spawn,
        ready: async () => true,
        onSignal: vi.fn(),
        env: {},
      }).started;
      return calls[0];
    };
    const quiet = await start([]);
    expect(quiet[1].slice(-2)).toEqual(['--logLevel', 'warn']);
    expect(quiet[2].env.VITE_SHOPIFY_THEME_CLI).toBe('1');
    for (const choice of [['--logLevel', 'info'], ['-l', 'error'], ['--logLevel=silent']]) {
      const chosen = await start(choice);
      expect(chosen[1].filter((argument: string) => argument === 'warn')).toEqual([]);
      expect(chosen[2].env).toBeUndefined();
    }
    const raw = await start(['--raw']);
    expect(raw[1].includes('--logLevel')).toBe(false);
    expect(raw[2].env).toBeUndefined();
  });

  it('quotes Shopify arguments for the Windows shell', async () => {
    const calls: any[] = [];
    const spawn = ((...args: any[]) => {
      calls.push(args);
      return Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    }) as never;
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-dev-'));
    await runDevelopment(['--', '--theme', 'My Theme'], {
      cwd: root,
      platform: 'win32',
      spawn,
      ready: async () => true,
      onSignal: vi.fn(),
    }).started;
    expect(calls[1][0]).toBe('shopify theme dev --theme "My Theme"');
  });

  it('uses a shell only for the Windows Shopify shim', async () => {
    const calls: any[] = [];
    const spawn = ((...args: any[]) => {
      calls.push(args);
      return Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    }) as never;
    await runDevelopment([], { platform: 'win32', spawn, ready: async () => true, onSignal: vi.fn() }).started;
    expect(calls[0][2].shell).toBeUndefined();
    expect(calls[1][0]).toBe('shopify theme dev');
    expect(calls[1][1].shell).toBe(true);
  });

  it('preserves Shopify environment and stops the sibling after a child failure', async () => {
    const previousExitCode = process.exitCode;
    const previousPath = process.env.SHOPIFY_FLAG_PATH;
    process.exitCode = undefined;
    process.env.SHOPIFY_FLAG_PATH = '/theme/from/environment';
    try {
      const children: any[] = [];
      const spawn = ((...args: any[]) => {
        const child = Object.assign(new EventEmitter(), {
          killed: false,
          kill: vi.fn(function (this: any) {
            this.killed = true;
          }),
        });
        children.push(child);
        if (args[0] === 'shopify') expect(args[2].env.SHOPIFY_FLAG_PATH).toBe('/theme/from/environment');
        return child;
      }) as never;
      await runDevelopment([], { platform: 'linux', spawn, ready: async () => true, onSignal: vi.fn() }).started;
      children[0].emit('exit', 7, null);
      expect(process.exitCode).toBe(7);
      expect(children[1].kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      process.exitCode = previousExitCode;
      if (previousPath === undefined) delete process.env.SHOPIFY_FLAG_PATH;
      else process.env.SHOPIFY_FLAG_PATH = previousPath;
    }
  });

  it('does not start Shopify when Vite exits before the snippet is ready', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      const children: any[] = [];
      const spawn = (() => {
        const child = Object.assign(new EventEmitter(), {
          killed: false,
          kill: vi.fn(function (this: any) {
            this.killed = true;
          }),
        });
        children.push(child);
        return child;
      }) as never;
      let release!: (ready: boolean) => void;
      const ready = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      const result = runDevelopment([], { spawn, ready: () => ready, onSignal: vi.fn() });
      children[0].emit('exit', 1, null);
      release(false);
      await result.started;
      expect(children).toHaveLength(1);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('detects the development snippet from this Vite process ownership record only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-ready-'));
    mkdirSync(join(root, '.vite-shopify-theme.lock'));
    const owner = join(root, '.vite-shopify-theme.lock', 'owner.json');
    writeFileSync(owner, JSON.stringify({ pid: 111, development: { snippet: 'x' } }));
    const spawned: any[] = [];
    const spawn = ((command: string) => {
      const child = Object.assign(new EventEmitter(), {
        killed: false,
        kill: vi.fn(),
        pid: command === process.execPath ? 222 : 333,
      });
      spawned.push(child);
      return child;
    }) as never;
    const result = runDevelopment([], { cwd: root, spawn, onSignal: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(spawned).toHaveLength(1);
    writeFileSync(owner, JSON.stringify({ pid: 222, development: { snippet: 'x' } }));
    await result.started;
    expect(spawned).toHaveLength(2);
  });

  it('reports spawn errors and forwards SIGTERM to both children', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      const children: any[] = [];
      const signals = new Map<string, () => void>();
      const spawn = (() => {
        const child = Object.assign(new EventEmitter(), {
          killed: false,
          kill: vi.fn(function (this: any) {
            this.killed = true;
          }),
        });
        children.push(child);
        return child;
      }) as never;
      await runDevelopment([], {
        spawn,
        ready: async () => true,
        onSignal: (signal, handler) => signals.set(signal, handler),
      }).started;
      children[0].emit('error', new Error('missing command'));
      expect(process.exitCode).toBe(1);
      expect(children[1].kill).toHaveBeenCalledWith('SIGTERM');
      expect(signals.has('SIGTERM')).toBe(true);
    } finally {
      process.exitCode = previousExitCode;
    }
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

  it('accepts string and object entries and normalizes entry options', () => {
    const root = fixture();
    const normalized = normalizeOptions(
      {
        entries: {
          'theme.ts': 'frontend/theme.ts',
          'theme.css': {
            source: 'frontend/theme.css',
            inline: true,
            attributes: { media: 'print', 'data-b': true, 'data-a': 'x' },
          },
        },
      },
      root,
    );
    expect(normalized.entries).toEqual({
      'theme.ts': join(root, 'frontend/theme.ts'),
      'theme.css': join(root, 'frontend/theme.css'),
    });
    expect(normalized.entryOptions['theme.ts']).toEqual({ attributes: {}, inline: false });
    expect(normalized.entryOptions['theme.css']).toEqual({
      attributes: { 'data-a': 'x', 'data-b': true, media: 'print' },
      inline: true,
    });
    expect(Object.keys(normalized.entryOptions['theme.css'].attributes)).toEqual(['data-a', 'data-b', 'media']);
  });

  it.each([
    ['unknown option', { source: 'frontend/theme.ts', extra: 1 }, /unknown option "extra"/],
    ['missing source', { attributes: {} }, /non-empty source path/],
    ['non-object entry', 5, /source path string or an object/],
    ['non-boolean inline', { source: 'frontend/theme.css', inline: 'yes' }, /"inline" must be a boolean/],
    ['inline on a script', { source: 'frontend/theme.ts', inline: true }, /only supported for stylesheet entries/],
    ['non-object attributes', { source: 'frontend/theme.ts', attributes: 'x' }, /attributes must be an object/],
    [
      'invalid attribute name',
      { source: 'frontend/theme.ts', attributes: { 'Data-X': 'a' } },
      /attribute "Data-X" is invalid/,
    ],
    ['reserved attribute', { source: 'frontend/theme.ts', attributes: { src: 'a' } }, /managed by the plugin/],
    [
      'crossorigin attribute',
      { source: 'frontend/theme.ts', attributes: { crossorigin: 'use-credentials' } },
      /managed by the plugin/,
    ],
    [
      'event handler attribute',
      { source: 'frontend/theme.ts', attributes: { onload: 'x()' } },
      /managed by the plugin/,
    ],
    [
      'non-string attribute value',
      { source: 'frontend/theme.ts', attributes: { 'data-x': 1 } },
      /must be a string or true/,
    ],
    [
      'false attribute value',
      { source: 'frontend/theme.ts', attributes: { 'data-x': false } },
      /must be a string or true/,
    ],
    [
      'Liquid output delimiter',
      { source: 'frontend/theme.ts', attributes: { 'data-x': '{{ secret }}' } },
      /Liquid delimiters/,
    ],
    ['Liquid tag delimiter', { source: 'frontend/theme.ts', attributes: { 'data-x': 'a %} b' } }, /Liquid delimiters/],
    ['control character', { source: 'frontend/theme.ts', attributes: { 'data-x': 'a\nb' } }, /control characters/],
  ])('rejects invalid entry options: %s', (_name, entry, message) => {
    const root = fixture();
    expect(() => normalizeOptions({ entries: { app: entry as never } }, root)).toThrow(
      new RegExp(`^\\[shopify-theme:CONFIG_ENTRIES\\].*${message.source}`),
    );
  });

  it('normalizes and validates optional diagnostic logging', () => {
    const root = fixture();
    expect(normalizeOptions({ entries: { app: 'frontend/theme.ts' } }, root).diagnostics).toBe(false);
    expect(normalizeOptions({ entries: { app: 'frontend/theme.ts' }, diagnostics: true }, root).diagnostics).toBe(true);
    expect(() =>
      normalizeOptions({ entries: { app: 'frontend/theme.ts' }, diagnostics: 'yes' as never }, root),
    ).toThrow(/^\[shopify-theme:CONFIG_DIAGNOSTICS\]/);
  });

  it('reports missing and non-directory Shopify output structure', () => {
    const missingAssets = fixture();
    rmSync(join(missingAssets, 'assets'), { recursive: true });
    expect(() => normalizeOptions({ entries: { app: 'frontend/theme.ts' } }, missingAssets)).toThrow(
      /^\[shopify-theme:THEME_STRUCTURE_INVALID\].*Shopify assets directory.*Create this directory.*themeRoot/,
    );

    const fileAssets = fixture();
    rmSync(join(fileAssets, 'assets'), { recursive: true });
    writeFileSync(join(fileAssets, 'assets'), 'not a directory');
    expect(() => normalizeOptions({ entries: { app: 'frontend/theme.ts' } }, fileAssets)).toThrow(
      /^\[shopify-theme:THEME_STRUCTURE_INVALID\].*Shopify assets directory.*not a directory/,
    );

    const missingSnippets = fixture();
    expect(() =>
      normalizeOptions(
        { entries: { app: 'frontend/theme.ts' }, snippet: 'liquid/generated/vite.liquid' },
        missingSnippets,
      ),
    ).toThrow(/^\[shopify-theme:THEME_STRUCTURE_INVALID\].*configured snippet directory.*Create this directory/);

    const fileSnippets = fixture();
    writeFileSync(join(fileSnippets, 'liquid'), 'not a directory');
    expect(() =>
      normalizeOptions({ entries: { app: 'frontend/theme.ts' }, snippet: 'liquid/vite.liquid' }, fileSnippets),
    ).toThrow(/^\[shopify-theme:THEME_STRUCTURE_INVALID\].*configured snippet directory.*not a directory/);
  });

  it('accepts an existing custom snippet directory', () => {
    const root = fixture();
    mkdirSync(join(root, 'liquid/generated'), { recursive: true });
    expect(
      normalizeOptions({ entries: { app: 'frontend/theme.ts' }, snippet: 'liquid/generated/vite.liquid' }, root)
        .snippet,
    ).toBe(join(root, 'liquid/generated/vite.liquid'));
  });

  it('normalizes valid entries and an HTTPS origin', () => {
    const root = fixture();
    const value = normalizeOptions(
      { entries: { 'theme.ts': 'frontend/theme.ts' }, devOrigin: 'https://theme.example.test' },
      root,
    );
    expect(value.devOrigin?.origin).toBe('https://theme.example.test');
  });

  it.each(['theme', 'theme.ts', 'theme.min.js', 'theme_2', 'theme-dark.css', '9-theme'])(
    'accepts Liquid-safe entry name %s',
    (name) => {
      const root = fixture();
      expect(normalizeOptions({ entries: { [name]: 'frontend/theme.ts' } }, root).entries[name]).toBe(
        join(root, 'frontend/theme.ts'),
      );
    },
  );

  it.each([
    '',
    "theme'",
    'theme\njs',
    'theme/js',
    'theme\\js',
    'theme js',
    '{{ theme }}',
    '{% theme %}',
    '.theme',
    '-theme',
    '_theme',
  ])('rejects unsafe Liquid entry name %j', (name) => {
    const root = fixture();
    expect(() => normalizeOptions({ entries: { [name]: 'frontend/theme.ts' } }, root)).toThrow(
      /Liquid entry name.*invalid.*ASCII letters/,
    );
  });

  it.each(['http://example.com', 'https://user@example.com', 'https://example.com/path', 'not a url'])(
    'rejects malformed or unsafe origin %s',
    (devOrigin) => {
      const root = fixture();
      expect(() => normalizeOptions({ entries: { app: 'frontend/theme.ts' }, devOrigin }, root)).toThrow(/HTTPS|valid/);
    },
  );

  it('preserves the original URL parsing failure as the diagnostic cause', () => {
    const root = fixture();
    let failure: unknown;
    try {
      normalizeOptions({ entries: { app: 'frontend/theme.ts' }, devOrigin: 'not a url' }, root);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBeInstanceOf(TypeError);
  });

  it('rejects missing, duplicate, and out-of-root entries', () => {
    const root = fixture();
    mkdirSync(join(root, 'frontend/folder'));
    expect(() => normalizeOptions({ entries: { app: 'missing.ts' } }, root)).toThrow(
      /Entry "app".*missing\.ts.*not found.*Create the file/,
    );
    expect(() => normalizeOptions({ entries: { app: 'frontend/folder' } }, root)).toThrow(
      /Entry "app".*not a file.*source file/,
    );
    expect(() => normalizeOptions({ entries: { a: 'frontend/theme.ts', b: 'frontend/theme.ts' } }, root)).toThrow(
      /Entry "b" duplicates.*distinct source/,
    );
    expect(() => normalizeOptions({ entries: { app: '../escape.ts' } }, root)).toThrow(
      /Entry "app".*outside theme root.*inside the theme/,
    );
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
    expect(() => normalizeOptions({ themeRoot: root, entries: { app: 'escape/escape.ts' } })).toThrow(
      /outside canonical theme root/,
    );
    symlinkSync(outside, join(root, 'escape-snippets'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() =>
      normalizeOptions({
        themeRoot: root,
        snippet: 'escape-snippets/vite-tag.liquid',
        entries: { app: 'frontend/theme.ts' },
      }),
    ).toThrow(/outside canonical theme root/);
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
    expect(() => collectManifestTags({}, ['frontend/missing.ts'])).toThrow(
      /^\[shopify-theme:MANIFEST_ENTRY_MISSING\].*frontend\/missing\.ts/,
    );
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
    const snippet = productionSnippet(
      manifest,
      {
        'theme.ts': join(root, 'frontend/theme.ts'),
        'theme.css': join(root, 'frontend/theme.css'),
      },
      root,
    );
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
    const snippet = renderProductionSnippet(manifest, { 'theme.ts': join(root, 'frontend/theme.ts') }, root, {
      modulePreload: false,
    });
    expect(snippet).toContain("{{ 'theme-a.css' | asset_url }}");
    expect(snippet).toContain("{{ 'theme-a.js' | asset_url }}");
    expect(snippet).not.toContain('modulepreload');
  });

  it('includes aggregated CSS exactly once in every branch', () => {
    const root = fixture();
    const snippet = renderProductionSnippet(
      manifest,
      {
        'theme.ts': join(root, 'frontend/theme.ts'),
        'theme.css': join(root, 'frontend/theme.css'),
      },
      root,
      { modulePreload: true, aggregateCss: 'style-z.css' },
    );
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

  it.each([
    'css',
    'pcss',
    'postcss',
    'scss',
    'sass',
    'less',
    'styl',
    'stylus',
    'module.scss',
    'module.pcss',
    'module.postcss',
    'CSS',
  ])('renders .%s entries as stylesheets in development', (extension) => {
    const root = fixture();
    const path = join(root, `frontend/theme.${extension}`);
    const snippet = developmentSnippet('https://vite.example.test', { theme: path }, root);
    expect(snippet).toContain(
      `<link rel="stylesheet" href="https://vite.example.test/frontend/theme.${extension}" crossorigin="anonymous">`,
    );
    expect(snippet).not.toContain(`<script type="module" src="https://vite.example.test/frontend/theme.${extension}"`);
  });
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
    const plugin = shopifyTheme({
      entries: { app: 'frontend/theme.ts' },
      themeRoot: root,
      devOrigin: 'https://vite.example.test',
    }) as any;
    const contribution = plugin.config({ root }, { command: 'serve', mode: 'development' });
    expect(contribution).toMatchObject({ publicDir: false, input: { app: join(root, 'frontend/theme.ts') } });
    expect(contribution.build.rolldownOptions.input).toEqual({ app: join(root, 'frontend/theme.ts') });
    expect(contribution.server).toMatchObject({
      allowedHosts: ['vite.example.test'],
      ws: { protocol: 'wss', host: 'vite.example.test', clientPort: 443 },
    });
    expect(contribution.server.hmr).toBeUndefined();
    const origins = contribution.server.cors.origin as Array<string | RegExp>;
    const allowed = (origin: string) =>
      origins.some((rule) => (typeof rule === 'string' ? rule === origin : rule.test(origin)));
    for (const origin of [
      'https://vite.example.test',
      'https://shop.myshopify.com',
      'https://admin.shopify.com',
      'http://127.0.0.1:9292',
      'http://localhost:9292',
    ])
      expect(allowed(origin), origin).toBe(true);
    for (const origin of [
      'https://evil.example',
      'https://myshopify.com.evil.example',
      'http://shop.myshopify.com',
      'https://notshopify.com',
    ])
      expect(allowed(origin), origin).toBe(false);
  });

  it('replaces direct stylesheet inputs with one virtual input only when CSS splitting is disabled', () => {
    const root = fixture();
    const plugin = shopifyTheme({
      entries: { 'theme.css': 'frontend/theme.css', app: 'frontend/theme.ts' },
      themeRoot: root,
    }) as any;
    const contribution = plugin.config(
      { root, build: { cssCodeSplit: false } },
      { command: 'build', mode: 'production' },
    );
    expect(contribution.input).toEqual({
      app: join(root, 'frontend/theme.ts'),
      'style.css': 'virtual:shopify-theme-css-bundle',
    });
    expect(plugin.resolveId('virtual:shopify-theme-css-bundle')).toBe('\0virtual:shopify-theme-css-bundle');
    expect(plugin.load('\0virtual:shopify-theme-css-bundle')).toBe(
      `import ${JSON.stringify(join(root, 'frontend/theme.css'))};`,
    );
  });

  it('aggregates .pcss and .postcss stylesheet inputs when CSS splitting is disabled', () => {
    const root = fixture();
    writeFileSync(join(root, 'frontend/theme.pcss'), '.pcss {}');
    writeFileSync(join(root, 'frontend/admin.postcss'), '.postcss {}');
    const plugin = shopifyTheme({
      entries: {
        'theme.pcss': 'frontend/theme.pcss',
        'admin.postcss': 'frontend/admin.postcss',
      },
      themeRoot: root,
    }) as any;
    const contribution = plugin.config(
      { root, build: { cssCodeSplit: false } },
      { command: 'build', mode: 'production' },
    );
    expect(contribution.input).toEqual({ 'style.css': 'virtual:shopify-theme-css-bundle' });
    expect(plugin.load('\0virtual:shopify-theme-css-bundle')).toBe(
      [
        `import ${JSON.stringify(join(root, 'frontend/theme.pcss'))};`,
        `import ${JSON.stringify(join(root, 'frontend/admin.postcss'))};`,
      ].join('\n'),
    );
  });

  it('leaves development inputs unchanged when the shared config disables CSS splitting', () => {
    const root = fixture();
    const plugin = shopifyTheme({
      entries: { 'theme.css': 'frontend/theme.css', app: 'frontend/theme.ts' },
      themeRoot: root,
    }) as any;
    const contribution = plugin.config(
      { root, build: { cssCodeSplit: false } },
      { command: 'serve', mode: 'development' },
    );
    expect(contribution.input).toEqual({
      'theme.css': join(root, 'frontend/theme.css'),
      app: join(root, 'frontend/theme.ts'),
    });
    expect(plugin.resolveId('virtual:shopify-theme-css-bundle')).toBeUndefined();
  });

  it.each([
    [{ appType: 'spa' }, 'appType'],
    [{ base: '/' }, 'base'],
    [{ publicDir: 'public' }, 'publicDir'],
    [{ input: { other: 'frontend/theme.ts' } }, 'input'],
    [{ input: '' }, 'input'],
    [{ build: { outDir: 'dist' } }, 'build.outDir'],
    [{ build: { emptyOutDir: true } }, 'build.emptyOutDir'],
    [{ build: { manifest: false } }, 'build.manifest'],
    [{ build: { rolldownOptions: { input: 'frontend/theme.ts' } } }, 'build.rolldownOptions.input'],
  ] as const)('rejects plugin-owned configuration %#', (user, key) => {
    const root = fixture();
    const plugin = shopifyTheme({ entries: { app: 'frontend/theme.ts' }, themeRoot: root }) as any;
    expect(() => plugin.config({ root, ...user }, { command: 'build', mode: 'production' })).toThrow(
      new RegExp(`option "${key.replaceAll('.', '\\.')}".*Remove "${key.replaceAll('.', '\\.')}"`),
    );
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
    const modules = plugin.handleHotUpdate({
      file: join(root, 'sections/hello-world.liquid'),
      server: { ws: { send } },
    });
    expect(send).toHaveBeenCalledWith({ type: 'custom', event: 'shopify:theme-update', data: {} });
    expect(modules).toEqual([]);
  });
});

describe('snippet size warning', () => {
  it("stays quiet for small snippets and warns near Shopify's 256 kB limit", () => {
    expect(snippetSizeWarning('x'.repeat(1000), 'snippets/vite-tag.liquid')).toBeUndefined();
    const warning = snippetSizeWarning('x'.repeat(SNIPPET_SIZE_LIMIT - 1000), 'snippets/vite-tag.liquid');
    expect(warning).toMatch(/^\[shopify-theme:SNIPPET_SIZE_NEAR_LIMIT\].*snippets\/vite-tag\.liquid.*262144/);
  });
});

describe('entry options rendering', () => {
  const root = '/theme';
  const manifest: Manifest = {
    'frontend/theme.css': { file: 'theme-a.css', isEntry: true },
    'frontend/theme.ts': { file: 'theme-b.js', isEntry: true, css: ['theme-b.css'], imports: ['shared'] },
    shared: { file: 'shared-c.js' },
  };
  const entries = { 'theme.css': `${root}/frontend/theme.css`, 'theme.ts': `${root}/frontend/theme.ts` };
  const attributes: Record<string, string | true> = { media: 'print', 'data-z': true, 'data-a': 'a"<&>' };

  it('renders sorted, escaped attributes on production links and scripts but not on preloads', () => {
    const snippet = renderProductionSnippet(manifest, entries, root, {
      modulePreload: true,
      entryOptions: { 'theme.ts': { attributes, inline: false } },
    });
    const attrs = ' data-a="a&quot;&lt;&amp;&gt;" data-z media="print"';
    expect(snippet).toContain(`<link rel="stylesheet" href="{{ 'theme-b.css' | asset_url }}"${attrs}>`);
    expect(snippet).toContain(`<script type="module" src="{{ 'theme-b.js' | asset_url }}"${attrs}></script>`);
    expect(snippet).toContain(`<link rel="modulepreload" href="{{ 'shared-c.js' | asset_url }}">`);
    expect(snippet).toContain(`<link rel="stylesheet" href="{{ 'theme-a.css' | asset_url }}">`);
  });

  it('renders identical output regardless of attribute declaration order', () => {
    const forward = { a: 'x', b: 'y' };
    const reversed = { b: 'y', a: 'x' };
    const render = (value: Record<string, string>) =>
      renderProductionSnippet(manifest, entries, root, {
        modulePreload: true,
        entryOptions: { 'theme.ts': { attributes: value, inline: false } },
      });
    expect(render(forward)).toBe(render(reversed));
  });

  it('inlines a stylesheet entry with inline_asset_content', () => {
    const snippet = renderProductionSnippet(manifest, entries, root, {
      modulePreload: true,
      entryOptions: { 'theme.css': { attributes: {}, inline: true } },
    });
    expect(snippet).toContain("{% when 'theme.css' %}\n<style>{{ 'theme-a.css' | inline_asset_content }}</style>");
    expect(snippet).not.toContain("{{ 'theme-a.css' | asset_url }}");
  });

  it('falls back to a link when the stylesheet cannot be inlined', () => {
    const snippet = renderProductionSnippet(manifest, entries, root, {
      modulePreload: true,
      canInline: () => false,
      entryOptions: { 'theme.css': { attributes: { media: 'all' }, inline: true } },
    });
    expect(snippet).toContain(`<link rel="stylesheet" href="{{ 'theme-a.css' | asset_url }}" media="all">`);
    expect(snippet).not.toContain('inline_asset_content');
  });

  it('keeps links for inline entries when stylesheets are aggregated', () => {
    const snippet = renderProductionSnippet(manifest, entries, root, {
      modulePreload: true,
      aggregateCss: 'style-z.css',
      entryOptions: { 'theme.css': { attributes: {}, inline: true } },
    });
    expect(snippet).not.toContain('inline_asset_content');
  });

  it('applies attributes to development tags and ignores inline', () => {
    const snippet = developmentSnippet('https://vite.example.test', entries, root, {
      'theme.css': { attributes: { media: 'print' }, inline: true },
      'theme.ts': { attributes: { 'data-x': true }, inline: false },
    });
    expect(snippet).toContain(
      '<link rel="stylesheet" href="https://vite.example.test/frontend/theme.css" crossorigin="anonymous" media="print">',
    );
    expect(snippet).toContain(
      '<script type="module" src="https://vite.example.test/frontend/theme.ts" crossorigin="anonymous" data-x></script>',
    );
    expect(snippet).not.toContain('inline_asset_content');
  });

  it('leaves output unchanged when no entry options are given', () => {
    const plain = renderProductionSnippet(manifest, entries, root, { modulePreload: true });
    const explicit = renderProductionSnippet(manifest, entries, root, {
      modulePreload: true,
      entryOptions: { 'theme.css': { attributes: {}, inline: false }, 'theme.ts': { attributes: {}, inline: false } },
    });
    expect(explicit).toBe(plain);
  });
});

describe('terminal output', () => {
  const plain = { color: false };
  const colored = { color: true };
  // Strips ANSI color escapes, which start with a control character.
  // oxlint-disable-next-line no-control-regex
  const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
  const header = {
    version: '0.7.0',
    mode: 'hmr',
    vite: '8.3.4',
    node: 'v26.12.0',
    shopify: '4.9.3',
    store: 'shop.myshopify.com',
    environment: 'development',
  } as const;

  it('uses color only on an interactive terminal without NO_COLOR, CI, or a dumb terminal', () => {
    expect(outputStyle({}, true).color).toBe(true);
    expect(outputStyle({}, false).color).toBe(false);
    expect(outputStyle({ NO_COLOR: '1' }, true).color).toBe(false);
    expect(outputStyle({ CI: 'true' }, true).color).toBe(false);
    expect(outputStyle({ TERM: 'dumb' }, true).color).toBe(false);
  });

  it('formats the header as plain text and the same text with color', () => {
    const text = formatHeader(header, plain);
    expect(text).toBe(
      'vite-shopify-theme 0.7.0 · HMR\n  versions  Vite 8.3.4 · Shopify CLI 4.9.3 · Node 26.12.0\n  store     shop.myshopify.com (environment: development)\n\n',
    );
    expect(strip(formatHeader(header, colored))).toBe(text);
    expect(formatHeader(header, colored)).toContain('\x1b[');
    expect(text).not.toContain('\x1b[');
  });

  it('shows the theme folder Shopify CLI serves only when an explicit path was given', () => {
    const withPath = formatHeader({ ...header, themePath: '.shopify-devtools/theme' }, plain);
    expect(withPath).toBe(
      'vite-shopify-theme 0.7.0 · HMR\n  versions  Vite 8.3.4 · Shopify CLI 4.9.3 · Node 26.12.0\n  store     shop.myshopify.com (environment: development)\n  theme     .shopify-devtools/theme\n\n',
    );
    expect(formatHeader(header, plain)).not.toContain('theme     ');
  });

  it('shows the editor asset row with the live-reload mode and omits unknown values', () => {
    const text = formatHeader(
      { version: '0.7.0', mode: 'editor', vite: '8.3.4', node: 'v26.12.0', liveReload: 'off' },
      plain,
    );
    expect(text).toBe(
      'vite-shopify-theme 0.7.0 · editor\n  versions  Vite 8.3.4 · Node 26.12.0\n  assets    built to assets/ · synced by Shopify CLI · live reload: off\n\n',
    );
    expect(formatHeader({ version: '0.7.0', mode: 'editor', vite: '8.3.4', node: 'v26.12.0' }, plain)).toContain(
      'live reload: full-page',
    );
  });

  it('formats the footer for each way the session can end', () => {
    expect(formatFooter({ mode: 'hmr', lockRemains: false }, plain)).toBe('\nStopped. Development snippet restored.\n');
    expect(formatFooter({ mode: 'editor', lockRemains: false }, plain)).toBe(
      '\nStopped. Generated snippet kept; run vite build before deploying.\n',
    );
    expect(formatFooter({ mode: 'hmr', lockRemains: true, exitCode: 1 }, plain)).toContain(
      'Stopped (exit code 1). A lock remains in .vite-shopify-theme.lock',
    );
  });

  it('reads the store and environment from flags, environment variables, or shopify.theme.toml', () => {
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-target-'));
    writeFileSync(
      join(root, 'shopify.theme.toml'),
      '[environments.staging]\nstore = "staging.myshopify.com"\n[environments.development]\ntheme = 1\nstore = "dev.myshopify.com" # local\n',
    );
    expect(describeTarget(root, ['theme', 'dev', '--environment', 'development'], {})).toEqual({
      store: 'dev.myshopify.com',
      environment: 'development',
    });
    expect(describeTarget(root, ['theme', 'dev', '-e', 'staging'], {})).toEqual({
      store: 'staging.myshopify.com',
      environment: 'staging',
    });
    expect(describeTarget(root, ['theme', 'dev', '--store=flag.myshopify.com'], {})).toEqual({
      store: 'flag.myshopify.com',
    });
    expect(describeTarget(root, ['theme', 'dev'], { SHOPIFY_FLAG_STORE: 'env.myshopify.com' })).toEqual({
      store: 'env.myshopify.com',
    });
    expect(describeTarget(mkdtempSync(join(tmpdir(), 'shopify-theme-target-')), ['theme', 'dev'], {})).toEqual({});
  });

  it('formats one build line for a successful build, a single entry, and a failure', () => {
    expect(formatBuildLine({ ok: true, entries: 2, ms: 311.6, snippet: 'written' }, plain)).toBe(
      '[shopify-theme] build ok · 2 entries · 312 ms · snippet written',
    );
    expect(formatBuildLine({ ok: true, entries: 1, ms: 4, snippet: 'unchanged' }, plain)).toBe(
      '[shopify-theme] build ok · 1 entry · 4 ms · snippet unchanged',
    );
    expect(formatBuildLine({ ok: false }, plain)).toBe('[shopify-theme] build failed · keeping the last good output');
    expect(strip(formatBuildLine({ ok: false }, colored))).toBe(formatBuildLine({ ok: false }, plain));
    expect(formatBuildLine({ ok: false }, colored)).toContain('\x1b[31m');
  });

  it('finds the generated-file patterns missing from .gitignore', () => {
    expect(missingGeneratedPatterns(undefined)).toHaveLength(5);
    expect(missingGeneratedPatterns('node_modules/\n.vite-shopify-theme.json\n')).toEqual([
      '.vite-shopify-theme.lock',
      'assets/vite-manifest.json',
      'assets/*-????????.css',
      'assets/*-????????.js',
    ]);
    expect(
      missingGeneratedPatterns(
        '.vite-shopify-theme.json\r\n.vite-shopify-theme.lock\r\nassets/vite-manifest.json\r\nassets/*-????????.css\r\nassets/*-????????.js\r\n',
      ),
    ).toEqual([]);
    expect(missingGeneratedPatterns('.vite-shopify-theme.json\n.vite-shopify-theme.lock\nassets/\n')).toEqual([]);
    expect(formatGitignoreHint([], plain)).toBe('');
    expect(formatGitignoreHint(['assets/*-????????.js'], plain)).toContain(
      'lacks a generated-file pattern; Tailwind CSS then rebuilds in a loop.',
    );
    expect(formatGitignoreHint(missingGeneratedPatterns(undefined), plain)).toContain(
      '.gitignore lacks 5 generated-file patterns; Tailwind CSS then rebuilds in a loop. The patterns are listed here:',
    );
  });

  function session(
    argumentsList: string[],
    options: { lock?: boolean; version?: string | undefined; env?: NodeJS.ProcessEnv } = {},
  ) {
    const events: string[] = [];
    const children: any[] = [];
    const spawn = ((command: string) => {
      events.push(`spawn:${command === process.execPath ? 'vite' : command}`);
      const child = Object.assign(new EventEmitter(), {
        killed: false,
        kill: vi.fn(function (this: any) {
          this.killed = true;
        }),
      });
      children.push(child);
      return child;
    }) as never;
    const root = mkdtempSync(join(tmpdir(), 'shopify-theme-session-'));
    writeFileSync(join(root, 'shopify.theme.toml'), '[environments.development]\nstore = "dev.myshopify.com"\n');
    if (options.lock) mkdirSync(join(root, '.vite-shopify-theme.lock'));
    const signals = new Map<string, () => void>();
    const result = runDevelopment(argumentsList, {
      cwd: root,
      platform: 'linux',
      spawn,
      ready: async () => true,
      onSignal: (signal, handler) => signals.set(signal, handler),
      write: (text) => events.push(`write:${text}`),
      env: options.env ?? {},
      isTTY: false,
      ...('version' in options ? { version: options.version } : { version: '0.7.0' }),
    });
    return { events, children, result, signals };
  }

  it('names the theme folder from --path or SHOPIFY_FLAG_PATH in the header', () => {
    const fromEnv = session([], { env: { SHOPIFY_FLAG_PATH: '.shopify-devtools/theme' } });
    expect(fromEnv.events[0]).toContain('  theme     .shopify-devtools/theme\n');
    const fromFlag = session(['--', '--path', 'generated/theme']);
    expect(fromFlag.events[0]).toContain('  theme     generated/theme\n');
    expect(session([]).events[0]).not.toContain('  theme     ');
  });

  it('prints the header before anything starts and the footer after both processes exit', async () => {
    const { events, children, result, signals } = session([]);
    expect(events[0]).toMatch(/^write:vite-shopify-theme 0\.7\.0 · HMR\n {2}versions {2}Vite \d/);
    expect(events[0]).toContain('store     dev.myshopify.com (environment: development)');
    expect(events[1]).toBe('spawn:vite');
    await result.started;
    signals.get('SIGINT')?.();
    children[0].emit('exit', 0, null);
    expect(events.some((event) => event.startsWith('write:\nStopped.'))).toBe(false);
    children[1].emit('exit', null, 'SIGINT');
    expect(events.filter((event) => event.startsWith('write:\nStopped.'))).toHaveLength(1);
    expect(events.at(-1)).toContain('Development snippet restored.');
    process.exitCode = undefined;
  });

  it('writes the header before Shopify starts and nothing between the header and Shopify CLI output', async () => {
    const { events, result } = session([]);
    await result.started;
    const shopify = events.indexOf('spawn:shopify');
    expect(shopify).toBeGreaterThan(0);
    expect(events.slice(0, shopify).filter((event) => event.startsWith('write:'))).toHaveLength(1);
  });

  it('hints about missing .gitignore patterns in editor mode only', async () => {
    const editor = session(['--editor']);
    expect(editor.events[0]).toContain('hint  .gitignore lacks 5 generated-file patterns');
    expect(editor.events[0]).toContain('troubleshooting#dev-editor-or-vite-build-watch-rebuilds-again-and-again');
    expect(session([]).events[0]).not.toContain('hint');
    expect(session(['--editor', '--raw']).events.filter((event) => event.startsWith('write:'))).toEqual([]);
    await editor.result.started;
  });

  it('does not report an exit code for a stop the user asked for, but does when a process fails on its own', async () => {
    const stopped = session([]);
    await stopped.result.started;
    stopped.signals.get('SIGINT')?.();
    stopped.children[0].emit('exit', null, 'SIGINT');
    stopped.children[1].emit('exit', null, 'SIGINT');
    expect(stopped.events.at(-1)).toBe('write:\nStopped. Development snippet restored.\n');
    process.exitCode = undefined;
    const failed = session([]);
    await failed.result.started;
    failed.children[0].emit('exit', 2, null);
    failed.children[1].emit('exit', null, 'SIGTERM');
    expect(failed.events.at(-1)).toContain('Stopped (exit code 2).');
    process.exitCode = undefined;
  });

  it('reports a remaining lock in the footer', async () => {
    const { events, children, result, signals } = session(['--editor'], { lock: true });
    await result.started;
    signals.get('SIGTERM')?.();
    for (const child of children) child.emit('exit', 0, null);
    expect(events.at(-1)).toContain('A lock remains in .vite-shopify-theme.lock');
    process.exitCode = undefined;
  });

  it('prints nothing of its own with --raw or without a version', async () => {
    const raw = session(['--raw', '--host']);
    await raw.result.started;
    raw.signals.get('SIGINT')?.();
    for (const child of raw.children) child.emit('exit', 0, null);
    expect(raw.events.filter((event) => event.startsWith('write:'))).toEqual([]);
    const quiet = session([], { version: undefined });
    await quiet.result.started;
    expect(quiet.events.filter((event) => event.startsWith('write:'))).toEqual([]);
    process.exitCode = undefined;
  });
});

describe('public API documentation', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const documentation = read('../docs/public-api.md');
  const rows = (section: string) => {
    const start = documentation.indexOf(`## ${section}`);
    const end = documentation.indexOf('\n## ', start + 1);
    return documentation.slice(start, end === -1 ? undefined : end);
  };

  it('lists every diagnostic code, and only real ones', () => {
    const declared = read('../src/config.ts').match(/export type DiagnosticCode =([^;]+);/)?.[1] ?? '';
    const codes = [...declared.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
    const documented = [...rows('Diagnostic codes').matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1]).sort();
    expect(codes.length).toBeGreaterThan(30);
    expect(documented).toEqual(codes);
  });

  it('documents every root export as public or deprecated', async () => {
    const exported = Object.keys(await import('../src/index.js')).sort();
    const deprecated = [...rows('Deprecated exports').matchAll(/^\| `(\w+)` \|/gm)].map((match) => match[1]);
    const runtimeDeprecated = ['collectManifestTags', 'developmentSnippet', 'normalizeOptions', 'productionSnippet'];
    expect(exported).toEqual(['default', 'shopifyTheme', ...runtimeDeprecated].sort());
    for (const name of runtimeDeprecated) expect(deprecated, name).toContain(name);
    for (const name of ['NormalizedOptions', 'ManifestTags']) expect(deprecated, name).toContain(name);
  });
});
