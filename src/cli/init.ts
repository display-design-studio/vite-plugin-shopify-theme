import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export type Language = 'js' | 'ts';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export interface InitOptions {
  directory?: string;
  mode?: 'new' | 'existing';
  language?: Language;
  packageManager?: PackageManager;
  tailwind?: boolean;
  yes?: boolean;
}

export interface InitRuntime {
  cwd?: string;
  version: string;
  run?: (command: string, args: string[], cwd: string) => void;
  confirm?: (question: string, defaultValue: boolean) => Promise<boolean>;
  select?: <T extends string>(question: string, choices: readonly T[], defaultValue: T) => Promise<T>;
  log?: (message: string) => void;
}

// Pinned release: `--latest` fails on shallow clones and `main` uses Liquid tags stores may not support yet.
const skeletonUrl = 'https://github.com/Shopify/skeleton-theme.git#v1.0.0';
const exampleEnvironment = '[environments.development]\nstore = "your-store.myshopify.com"\n';
const placeholderSnippet = '{% comment %} Placeholder created by vite-shopify-theme init. It is replaced by `vite build` and `dev`. {% endcomment %}\n';
const managers = ['npm', 'pnpm', 'yarn', 'bun'] as const;

function detectedManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

const viteConfigNames = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((extension) => `vite.config.${extension}`);

// A project that already owns a Vite config keeps it: setup would otherwise add unused entries and change files it does not own.
// A config that setup generated earlier is not "owned", so reruns stay idempotent.
function hasOwnViteConfig(root: string, generated: Map<string, string>) {
  return viteConfigNames.some((name) => {
    const path = join(root, name);
    return existsSync(path) && readFileSync(path, 'utf8') !== generated.get(name);
  });
}

function validTheme(root: string) {
  return ['assets', 'layout', 'snippets'].every((name) => {
    const path = join(root, name);
    return existsSync(path) && statSync(path).isDirectory();
  });
}

function quote(value: string) {
  return JSON.stringify(value);
}

function mergeLines(current: string, additions: string[]) {
  const normalized = current.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const lines = normalized ? normalized.split('\n') : [];
  for (const addition of additions) if (!lines.includes(addition)) lines.push(addition);
  return `${lines.join('\n')}\n`;
}

function desiredFiles(language: Language, tailwind: boolean) {
  const extension = language === 'ts' ? 'ts' : 'js';
  const config = `import { defineConfig } from 'vite';\nimport shopify from '@display-studio/vite-plugin-shopify-theme';${tailwind ? "\nimport tailwindcss from '@tailwindcss/vite';" : ''}\n\nexport default defineConfig({\n  plugins: [${tailwind ? 'tailwindcss(), ' : ''}shopify({\n    entries: {\n      'theme.css': 'frontend/entrypoints/theme.css',\n      'theme.${extension}': 'frontend/entrypoints/theme.${extension}',\n    },\n  })],\n});\n`;
  return new Map([
    [`vite.config.${extension}`, config],
    ['frontend/entrypoints/theme.css', tailwind ? '@import "tailwindcss";\n' : '/* Theme styles */\n'],
    [`frontend/entrypoints/theme.${extension}`, '// Theme scripts\n'],
  ]);
}

function renderTags(extension: string) {
  return {
    head: "  {% render 'vite-tag' %}\n  {% render 'vite-tag', entry: 'theme.css' %}\n",
    body: `  {% render 'vite-tag', entry: 'theme.${extension}' %}\n`,
  };
}

function patchedLayout(source: string, extension: string): string | undefined {
  const tags = renderTags(extension);
  const clientIntegrated = source.includes("{% render 'vite-tag' %}");
  const headIntegrated = source.includes("{% render 'vite-tag', entry: 'theme.css' %}");
  const bodyIntegrated = source.includes(`{% render 'vite-tag', entry: 'theme.${extension}' %}`);
  if (clientIntegrated && headIntegrated && bodyIntegrated) return source;
  if ((source.match(/<\/head>/gi)?.length ?? 0) !== 1 || (source.match(/<\/body>/gi)?.length ?? 0) !== 1) return undefined;
  let output = source;
  if (!clientIntegrated || !headIntegrated) {
    const missingHeadTags = `${clientIntegrated ? '' : "  {% render 'vite-tag' %}\n"}${headIntegrated ? '' : "  {% render 'vite-tag', entry: 'theme.css' %}\n"}`;
    output = output.replace(/<\/head>/i, `${missingHeadTags}</head>`);
  }
  if (!bodyIntegrated) output = output.replace(/<\/body>/i, `${tags.body}</body>`);
  return output;
}

function installCommand(manager: PackageManager, packages: string[]) {
  if (manager === 'npm') return ['npm', ['install', '--save-dev', ...packages]] as const;
  if (manager === 'pnpm') return ['pnpm', ['add', '--save-dev', ...packages]] as const;
  if (manager === 'yarn') return ['yarn', ['add', '--dev', ...packages]] as const;
  return ['bun', ['add', '--dev', ...packages]] as const;
}

async function defaultSelect<T extends string>(question: string, choices: readonly T[], defaultValue: T) {
  if (!stdin.isTTY || !stdout.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question(`${question} (${choices.join('/')}) [${defaultValue}]: `)).trim();
      if (!answer) return defaultValue;
      if (!choices.includes(answer as T)) throw new Error(`Expected one of: ${choices.join(', ')}`);
      return answer as T;
    } finally { rl.close(); }
  }
  let index = Math.max(0, choices.indexOf(defaultValue));
  const render = (first: boolean) => {
    if (!first) stdout.write(`\x1b[${choices.length}A`);
    for (const [i, choice] of choices.entries()) stdout.write(`\x1b[2K${i === index ? '\x1b[36m❯' : ' '} ${choice}${i === index ? '\x1b[0m' : ''}\n`);
  };
  stdout.write(`${question} (↑/↓, enter)\n`);
  render(true);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  try {
    return await new Promise<T>((resolvePromise, reject) => {
      const onKey = (_: string, key: { name?: string; ctrl?: boolean }) => {
        if (key.ctrl && key.name === 'c') { stdin.off('keypress', onKey); reject(new Error('Setup cancelled.')); return; }
        if (key.name === 'up' || key.name === 'k') index = (index - 1 + choices.length) % choices.length;
        else if (key.name === 'down' || key.name === 'j') index = (index + 1) % choices.length;
        else if (key.name === 'return') { stdin.off('keypress', onKey); resolvePromise(choices[index]!); return; }
        else return;
        render(false);
      };
      stdin.on('keypress', onKey);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

async function defaultConfirm(question: string, defaultValue: boolean) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} [${defaultValue ? 'Y/n' : 'y/N'}]: `)).trim().toLowerCase();
    return answer ? answer === 'y' || answer === 'yes' : defaultValue;
  } finally { rl.close(); }
}

export async function initialize(options: InitOptions, runtime: InitRuntime) {
  const cwd = resolve(runtime.cwd ?? process.cwd());
  const root = resolve(cwd, options.directory ?? '.');
  const log = runtime.log ?? console.log;
  const run = runtime.run ?? ((command, args, directory) => execFileSync(command, args, { cwd: directory, stdio: 'inherit' }));
  const select = runtime.select ?? defaultSelect;
  const confirm = runtime.confirm ?? defaultConfirm;
  const exists = existsSync(root);
  const inferredMode = exists ? 'existing' : 'new';
  if (options.mode && options.mode !== inferredMode) throw new Error(options.mode === 'new' ? `Target already exists: ${root}` : `Existing theme not found: ${root}`);
  if (!exists) {
    mkdirSync(dirname(root), { recursive: true });
    run('shopify', ['theme', 'init', basename(root), '--path', dirname(root), '--clone-url', skeletonUrl], dirname(root));
    // The clone carries Skeleton's git history; a new project should start without it.
    rmSync(join(root, '.git'), { recursive: true, force: true });
  }
  if (!validTheme(root)) throw new Error(`Not a Shopify theme: ${root}. Expected assets, layout, and snippets directories; no files were changed.`);

  const existingConfig = viteConfigNames.some((name) => existsSync(join(root, name)));
  const language: Language = options.language ?? (options.yes || existingConfig ? 'ts' : await select<Language>('Language', ['ts', 'js'], 'ts'));
  const packageManager = options.packageManager ?? (options.yes ? detectedManager(root) : await select('Package manager', managers, detectedManager(root)));
  const tailwind = options.tailwind ?? (options.yes || existingConfig ? true : await confirm('Add Tailwind CSS?', true));
  const adopted = existingConfig && hasOwnViteConfig(root, desiredFiles(language, tailwind));
  const summary = adopted ? `Add the plugin to ${root} and keep its Vite config, entries, and layouts, using ${packageManager}?` : `Configure ${root} with ${language.toUpperCase()}, ${packageManager}, Tailwind ${tailwind ? 'on' : 'off'}?`;
  if (!options.yes && !await confirm(summary, true)) {
    log('Setup cancelled.');
    return { root, cancelled: true };
  }

  const files = desiredFiles(language, tailwind);
  const packagePath = join(root, 'package.json');
  const manifest = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, 'utf8')) : { name: basename(root), private: true };
  const expectedScripts = { build: 'vite build', dev: 'vite-shopify-theme dev' };
  const notes: string[] = [];
  if (!adopted) {
    for (const [name, expected] of Object.entries(expectedScripts)) {
      if (manifest.scripts?.[name] && manifest.scripts[name] !== expected) throw new Error(`Refusing to replace incompatible package script ${quote(name)}: ${manifest.scripts[name]}`);
    }
    if (manifest.type && manifest.type !== 'module') throw new Error(`Refusing to change package type ${quote(String(manifest.type))}; the Vite config imports an ESM-only package.`);
  }
  const nextManifest = adopted
    ? { ...manifest, scripts: { 'dev:editor': 'vite-shopify-theme dev --editor', ...manifest.scripts } }
    : { ...manifest, type: 'module', scripts: { 'dev:editor': 'vite-shopify-theme dev --editor', ...manifest.scripts, ...expectedScripts } };
  if (adopted) {
    for (const [name, expected] of Object.entries(expectedScripts)) {
      if (manifest.scripts?.[name] !== expected) notes.push(`Package script "${name}" was left unchanged${manifest.scripts?.[name] ? `: ${manifest.scripts[name]}` : ' (not defined)'}. Use "${expected}" to run the plugin.`);
    }
    notes.push("Add the plugin to your Vite config with one explicit entry per file that Liquid renders: shopify({ entries: { 'theme.css': 'frontend/entrypoints/theme.css', 'theme.js': 'frontend/entrypoints/theme.js' } }).");
    notes.push("Render the generated snippet in your layouts: {% render 'vite-tag' %} once in <head>, then {% render 'vite-tag', entry: 'theme.css' %} and {% render 'vite-tag', entry: 'theme.js' %}. The entry name is the key from `entries`.");
    notes.push('Remove `publicDir` from the Vite config and move files from public/ to assets/ (see the cookbook page on static files). Vite 8 is required.');
  }
  if (!adopted) {
    for (const [relative, contents] of files) {
      const path = join(root, relative);
      if (existsSync(path) && readFileSync(path, 'utf8') !== contents) throw new Error(`Refusing to overwrite incompatible manual file: ${relative}`);
    }
    for (const [relative, contents] of files) {
      const path = join(root, relative);
      mkdirSync(dirname(path), { recursive: true });
      if (!existsSync(path)) writeFileSync(path, contents);
    }
  }
  // Placeholder so the layout's render never fails before the first dev/build; both overwrite and later restore it.
  const snippetPath = join(root, 'snippets/vite-tag.liquid');
  if (!existsSync(snippetPath)) writeFileSync(snippetPath, placeholderSnippet);
  // Template for the Shopify CLI environment that `dev` selects automatically; the local copy stays out of git.
  const examplePath = join(root, 'example.shopify.theme.toml');
  if (!existsSync(examplePath)) writeFileSync(examplePath, exampleEnvironment);
  const nextPackage = `${JSON.stringify(nextManifest, null, 2)}\n`;
  if (!existsSync(packagePath) || readFileSync(packagePath, 'utf8') !== nextPackage) writeFileSync(packagePath, nextPackage);
  const gitignorePath = join(root, '.gitignore');
  writeFileSync(gitignorePath, mergeLines(existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '', ['node_modules/', '.vite-shopify-theme.json', '.vite-shopify-theme.lock', 'assets/vite-manifest.json', 'assets/*-????????.css', 'assets/*-????????.js', 'shopify.theme.toml']));
  const shopifyIgnorePath = join(root, '.shopifyignore');
  writeFileSync(shopifyIgnorePath, mergeLines(existsSync(shopifyIgnorePath) ? readFileSync(shopifyIgnorePath, 'utf8') : '', ['node_modules/*', 'frontend/*', 'vite.config.*', '.vite-shopify-theme.json', '.vite-shopify-theme.lock']));

  const layoutPath = join(root, 'layout/theme.liquid');
  let layoutInstructions: string | undefined;
  if (!adopted && existsSync(layoutPath)) {
    const current = readFileSync(layoutPath, 'utf8');
    const next = patchedLayout(current, language);
    if (next === undefined) layoutInstructions = `Add {% render 'vite-tag' %} and {% render 'vite-tag', entry: 'theme.css' %} before </head>, then {% render 'vite-tag', entry: 'theme.${language}' %} before </body>.`;
    else if (next !== current) writeFileSync(layoutPath, next);
  }

  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  const packages = [`@display-studio/vite-plugin-shopify-theme@${runtime.version}`];
  if (!adopted || !declared.vite) packages.unshift('vite@^8.0.0');
  if (!adopted && language === 'ts') packages.push('typescript');
  if (!adopted && tailwind) packages.push('tailwindcss', '@tailwindcss/vite');
  const [command, args] = installCommand(packageManager, packages);
  run(command, [...args], root);
  if (layoutInstructions) log(layoutInstructions);
  if (adopted) log(`Found an existing Vite config, so it, your entries, and your layouts were not changed.\n${notes.map((note) => `- ${note}`).join('\n')}`);
  log(`Configured Shopify theme at ${root}`);
  if (!existsSync(join(root, 'shopify.theme.toml'))) log('Next: copy example.shopify.theme.toml to shopify.theme.toml and set your store; `dev` then runs `shopify theme dev --environment development`.');
  return { root, cancelled: false, layoutInstructions, adopted };
}
