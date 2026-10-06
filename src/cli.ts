#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialize, type InitOptions, type Language, type PackageManager } from './cli/init.js';
import { runDevelopment } from './cli/dev.js';

function usage() {
  return `Usage:\n  vite-shopify-theme init [directory] [options]\n  vite-shopify-theme dev [vite options]\n\nInit options:\n  --new | --existing\n  --lang js|ts\n  --package-manager npm|pnpm|yarn|bun\n  --tailwind | --no-tailwind\n  --skills | --no-skills\n  --yes\n`;
}

export function parseInitArguments(arguments_: string[]): InitOptions {
  const options: InitOptions = {};
  let modeFlag: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--new' || argument === '--existing') {
      if (modeFlag) throw new Error(`${modeFlag} and ${argument} cannot be combined`);
      modeFlag = argument;
      options.mode = argument === '--new' ? 'new' : 'existing';
    }
    else if (argument === '--tailwind') options.tailwind = true;
    else if (argument === '--no-tailwind') options.tailwind = false;
    else if (argument === '--skills') options.skills = true;
    else if (argument === '--no-skills') options.skills = false;
    else if (argument === '--yes') options.yes = true;
    else if (argument === '--lang') options.language = arguments_[++index] as Language;
    else if (argument === '--package-manager') options.packageManager = arguments_[++index] as PackageManager;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else if (!options.directory) options.directory = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  if (options.language && !['js', 'ts'].includes(options.language)) throw new Error('--lang must be js or ts');
  if (options.packageManager && !['npm', 'pnpm', 'yarn', 'bun'].includes(options.packageManager)) throw new Error('--package-manager must be npm, pnpm, yarn, or bun');
  return options;
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') { console.log(usage()); return; }
  if (command === 'dev') { runDevelopment(arguments_); return; }
  if (command !== 'init') throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  await initialize(parseInitArguments(arguments_), { version: __PACKAGE_VERSION__ });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
declare const __PACKAGE_VERSION__: string;
