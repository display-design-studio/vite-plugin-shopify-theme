import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
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
  skills?: boolean;
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

const telemetryNotice = 'Shopify AI Toolkit has telemetry enabled by default. Privacy and opt-out: https://github.com/Shopify/shopify-ai-toolkit#telemetry';
const managers = ['npm', 'pnpm', 'yarn', 'bun'] as const;

function detectedManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
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
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} (${choices.join('/')}) [${defaultValue}]: `)).trim();
    if (!answer) return defaultValue;
    if (!choices.includes(answer as T)) throw new Error(`Expected one of: ${choices.join(', ')}`);
    return answer as T;
  } finally { rl.close(); }
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
    run('shopify', ['theme', 'init', basename(root), '--path', dirname(root), '--latest'], dirname(root));
  }
  if (!validTheme(root)) throw new Error(`Not a Shopify theme: ${root}. Expected assets, layout, and snippets directories; no files were changed.`);

  const language: Language = options.language ?? (options.yes ? 'ts' : await select<Language>('Language', ['ts', 'js'], 'ts'));
  const packageManager = options.packageManager ?? (options.yes ? detectedManager(root) : await select('Package manager', managers, detectedManager(root)));
  const tailwind = options.tailwind ?? (options.yes ? true : await confirm('Add Tailwind CSS?', true));
  if (options.skills !== false) log(telemetryNotice);
  const skills = options.skills ?? (options.yes ? true : await confirm('Install Shopify AI Toolkit skills?', true));
  if (!options.yes && !await confirm(`Configure ${root} with ${language.toUpperCase()}, ${packageManager}, Tailwind ${tailwind ? 'on' : 'off'}, skills ${skills ? 'on' : 'off'}?`, true)) {
    log('Setup cancelled.');
    return { root, cancelled: true };
  }

  const files = desiredFiles(language, tailwind);
  const packagePath = join(root, 'package.json');
  const manifest = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, 'utf8')) : { name: basename(root), private: true };
  for (const [name, expected] of Object.entries({ build: 'vite build', dev: 'vite-shopify-theme dev' })) {
    if (manifest.scripts?.[name] && manifest.scripts[name] !== expected) throw new Error(`Refusing to replace incompatible package script ${quote(name)}: ${manifest.scripts[name]}`);
  }
  const nextManifest = { ...manifest, scripts: { ...manifest.scripts, build: 'vite build', dev: 'vite-shopify-theme dev' } };
  for (const [relative, contents] of files) {
    const path = join(root, relative);
    if (existsSync(path) && readFileSync(path, 'utf8') !== contents) throw new Error(`Refusing to overwrite incompatible manual file: ${relative}`);
  }
  for (const [relative, contents] of files) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, contents);
  }
  const nextPackage = `${JSON.stringify(nextManifest, null, 2)}\n`;
  if (!existsSync(packagePath) || readFileSync(packagePath, 'utf8') !== nextPackage) writeFileSync(packagePath, nextPackage);
  const gitignorePath = join(root, '.gitignore');
  writeFileSync(gitignorePath, mergeLines(existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '', ['node_modules/', '.vite-shopify-theme.json', '.vite-shopify-theme.lock', 'assets/vite-manifest.json', 'assets/*-????????.css', 'assets/*-????????.js']));
  const shopifyIgnorePath = join(root, '.shopifyignore');
  writeFileSync(shopifyIgnorePath, mergeLines(existsSync(shopifyIgnorePath) ? readFileSync(shopifyIgnorePath, 'utf8') : '', ['node_modules/', 'frontend/', 'vite.config.*', '.vite-shopify-theme.json', '.vite-shopify-theme.lock']));

  const layoutPath = join(root, 'layout/theme.liquid');
  let layoutInstructions: string | undefined;
  if (existsSync(layoutPath)) {
    const current = readFileSync(layoutPath, 'utf8');
    const next = patchedLayout(current, language);
    if (next === undefined) layoutInstructions = `Add {% render 'vite-tag' %} and {% render 'vite-tag', entry: 'theme.css' %} before </head>, then {% render 'vite-tag', entry: 'theme.${language}' %} before </body>.`;
    else if (next !== current) writeFileSync(layoutPath, next);
  }

  const packages = ['vite@^8.0.0', `@display-studio/vite-plugin-shopify-theme@${runtime.version}`];
  if (language === 'ts') packages.push('typescript');
  if (tailwind) packages.push('tailwindcss', '@tailwindcss/vite');
  const [command, args] = installCommand(packageManager, packages);
  run(command, [...args], root);
  if (skills) {
    try {
      const skillArgs = ['skills', 'add', 'Shopify/shopify-ai-toolkit'];
      if (options.yes) skillArgs.unshift('--yes');
      if (options.yes) skillArgs.push('--yes');
      run('npx', skillArgs, root);
    } catch (error) {
      throw new Error(`Vite setup completed, but Shopify AI Toolkit installation failed. Retry from ${root} with: npx skills add Shopify/shopify-ai-toolkit`, { cause: error });
    }
  }
  if (layoutInstructions) log(layoutInstructions);
  log(`Configured Shopify theme at ${root}`);
  return { root, cancelled: false, layoutInstructions };
}

export { telemetryNotice };
