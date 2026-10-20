import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function fail(message, output) {
  throw new Error(`${message}\n--- command output ---\n${output.join('')}`);
}

export async function until(label, condition, output, timeout = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`Timed out waiting for ${label}.`, output);
}

/**
 * A stand-in Shopify CLI that records how it was started (arguments, directory, INIT_CWD, and whether the folder in
 * SHOPIFY_FLAG_PATH existed at that moment) and keeps running until it is stopped. Returns the directory to put on PATH.
 */
export function writeStandInShopify(temporary, record) {
  const bin = join(temporary, 'fake-bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'fake-shopify.mjs'),
    [
      "import { existsSync, writeFileSync } from 'node:fs';",
      "import { resolve } from 'node:path';",
      'const themePath = process.env.SHOPIFY_FLAG_PATH ? resolve(process.cwd(), process.env.SHOPIFY_FLAG_PATH) : undefined;',
      `writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), initCwd: process.env.INIT_CWD, themePathExists: themePath ? existsSync(themePath) : undefined }));`,
      "process.on('SIGINT', () => process.exit(0));",
      "process.on('SIGTERM', () => process.exit(0));",
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );
  if (process.platform === 'win32')
    writeFileSync(join(bin, 'shopify.cmd'), '@echo off\r\nnode "%~dp0fake-shopify.mjs" %*\r\n');
  else {
    writeFileSync(join(bin, 'shopify'), '#!/bin/sh\nexec node "$(dirname "$0")/fake-shopify.mjs" "$@"\n');
    chmodSync(join(bin, 'shopify'), 0o755);
  }
  return bin;
}
