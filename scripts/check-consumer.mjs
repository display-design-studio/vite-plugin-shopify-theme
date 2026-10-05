import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execNpmSync } from './npm-command.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'test', 'fixtures', 'compatibility');
const manager = process.argv[2] ?? process.env.PACKAGE_MANAGER ?? 'npm';
const commands = {
  npm: { install: ['install', '--no-audit', '--no-fund', '--save-dev'], build: ['exec', '--', 'vite', 'build'] },
  pnpm: { install: ['add', '--save-dev'], build: ['exec', 'vite', 'build'] },
  yarn: { install: ['add', '--dev'], build: ['vite', 'build'] },
  bun: { install: ['add', '--dev'], build: ['x', 'vite', 'build'] },
};

if (!(manager in commands)) throw new Error(`Unknown package manager ${JSON.stringify(manager)}. Use npm, pnpm, yarn, or bun.`);

function environment(temporary) {
  return { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_cache: join(temporary, 'npm-cache') };
}

function run(command, args, directory, temporary) {
  const options = { cwd: directory, stdio: 'inherit', env: environment(temporary) };
  if (command === 'npm') execNpmSync(args, options);
  else execFileSync(command, args, options);
}

const temporary = mkdtempSync(join(tmpdir(), `vite-plugin-shopify-theme-${manager}-consumer-`));
try {
  const packOutput = JSON.parse(execNpmSync(['pack', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', env: environment(temporary) }));
  const tarballName = (Array.isArray(packOutput) ? packOutput[0] : packOutput)?.filename;
  if (!tarballName) throw new Error('npm pack did not report a tarball filename.');
  const tarball = join(temporary, tarballName);
  const consumer = join(temporary, 'consumer');
  cpSync(fixture, consumer, { recursive: true });
  const command = commands[manager];
  const managerCommand = manager;
  run(managerCommand, [...command.install, tarball, 'vite@8'], consumer, temporary);
  run(managerCommand, command.build, consumer, temporary);
  const imported = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', [
    "import plugin, { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';",
    "console.log(JSON.stringify({ same: plugin === shopifyTheme, type: typeof plugin }));",
  ].join('\n')], { cwd: consumer, encoding: 'utf8' }));
  if (!imported.same || imported.type !== 'function') throw new Error('The installed public API did not import correctly.');
  const assets = join(consumer, 'assets');
  const manifest = JSON.parse(readFileSync(join(assets, 'vite-manifest.json'), 'utf8'));
  for (const source of ['frontend/entrypoints/theme.css', 'frontend/entrypoints/theme.ts']) {
    if (!manifest[source]?.file || !existsSync(join(assets, manifest[source].file))) throw new Error(`Missing generated output for ${source}.`);
  }
  const snippet = readFileSync(join(consumer, 'snippets', 'vite-tag.liquid'), 'utf8');
  if (!snippet.includes("{% when 'theme.css' %}") || !snippet.includes("{% when 'theme.ts' %}")) throw new Error('Generated snippet is missing explicit entries.');
  if (!existsSync(join(assets, 'manual.txt')) || !existsSync(join(consumer, 'snippets', 'manual.liquid'))) throw new Error('A manual theme file was not preserved.');
  const generated = readdirSync(assets).filter((file) => /\.(?:css|js)$/.test(file));
  if (generated.length < 2) throw new Error('Expected generated CSS and JavaScript assets.');
  console.log(`[consumer] ${manager} installed, imported, and built the packed package successfully.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
