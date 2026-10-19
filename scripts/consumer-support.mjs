import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execNpmSync } from './npm-command.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const fixture = join(root, 'test', 'fixtures', 'compatibility');

export const commands = {
  npm: { install: ['install', '--no-audit', '--no-fund', '--save-dev'], build: ['exec', '--', 'vite', 'build'] },
  pnpm: { install: ['add', '--save-dev'], build: ['exec', 'vite', 'build'] },
  yarn: { install: ['add', '--dev'], build: ['vite', 'build'] },
  bun: { install: ['add', '--dev'], build: ['x', 'vite', 'build'] },
};

export function selectManager(argument) {
  const manager = argument ?? process.env.PACKAGE_MANAGER ?? 'npm';
  if (!(manager in commands))
    throw new Error(`Unknown package manager ${JSON.stringify(manager)}. Use npm, pnpm, yarn, or bun.`);
  return manager;
}

export function environment(temporary) {
  return {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_cache: join(temporary, 'npm-cache'),
  };
}

export function run(command, args, directory, temporary) {
  const options = { cwd: directory, stdio: 'inherit', env: environment(temporary) };
  if (command === 'npm') execNpmSync(args, options);
  else execFileSync(command, args, options);
}

/** Packs the package, copies the compatibility fixture, and installs the tarball with Vite 8 using the chosen manager. */
export function installConsumer(manager, label) {
  const temporary = mkdtempSync(join(tmpdir(), `vite-plugin-shopify-theme-${manager}-${label}-`));
  const packOutput = JSON.parse(
    execNpmSync(['pack', '--json', '--pack-destination', temporary], {
      cwd: root,
      encoding: 'utf8',
      env: environment(temporary),
    }),
  );
  const packResult = Array.isArray(packOutput)
    ? packOutput[0]
    : packOutput?.filename
      ? packOutput
      : Object.values(packOutput ?? {})[0];
  const tarballName = packResult?.filename;
  if (!tarballName) throw new Error('npm pack did not report a tarball filename.');
  const consumer = join(temporary, 'consumer');
  cpSync(fixture, consumer, { recursive: true });
  run(manager, [...commands[manager].install, join(temporary, tarballName), 'vite@8'], consumer, temporary);
  return { temporary, consumer };
}
