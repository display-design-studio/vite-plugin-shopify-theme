// Smoke test for `vite-shopify-theme dev --editor` from the packed package, with a stand-in `shopify` command.
// It checks that the command starts, prints its header, builds, starts Shopify CLI with the right arguments and
// directory, rebuilds after an edit, and (where signals work) stops cleanly. No store or credentials are involved.
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { installConsumer, selectManager } from './consumer-support.mjs';

const manager = selectManager(process.argv[2]);
const windows = process.platform === 'win32';
const { temporary, consumer } = installConsumer(manager, 'editor');

function fail(message, output) {
  throw new Error(`${message}\n--- command output ---\n${output.join('')}`);
}

async function until(label, condition, output, timeout = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`Timed out waiting for ${label}.`, output);
}

try {
  // A stand-in Shopify CLI that records how it was started and keeps running until it is stopped.
  const bin = join(temporary, 'fake-bin');
  mkdirSync(bin);
  const record = join(temporary, 'shopify-call.json');
  writeFileSync(
    join(bin, 'fake-shopify.mjs'),
    [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), initCwd: process.env.INIT_CWD }));`,
      "process.on('SIGINT', () => process.exit(0));",
      "process.on('SIGTERM', () => process.exit(0));",
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );
  if (windows) writeFileSync(join(bin, 'shopify.cmd'), '@echo off\r\nnode "%~dp0fake-shopify.mjs" %*\r\n');
  else {
    writeFileSync(join(bin, 'shopify'), '#!/bin/sh\nexec node "$(dirname "$0")/fake-shopify.mjs" "$@"\n');
    chmodSync(join(bin, 'shopify'), 0o755);
  }
  writeFileSync(join(consumer, 'shopify.theme.toml'), '[environments.development]\nstore = "smoke.myshopify.com"\n');

  const cli = join(consumer, 'node_modules', '@display-studio', 'vite-plugin-shopify-theme', 'dist', 'cli.js');
  const output = [];
  const child = spawn(process.execPath, [cli, 'dev', '--editor'], {
    cwd: consumer,
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const text = () => output.join('');
  const builds = () => (text().match(/\[shopify-theme\] build ok/g) ?? []).length;

  await until('the first build', () => builds() >= 1, output);
  await until('Shopify CLI to start', () => existsSync(record), output);

  for (const expected of ['vite-shopify-theme', 'editor', 'store     smoke.myshopify.com (environment: development)'])
    if (!text().includes(expected)) fail(`The header is missing ${JSON.stringify(expected)}.`, output);
  const call = JSON.parse(readFileSync(record, 'utf8'));
  for (const expected of ['theme', 'dev', '--environment', 'development', '--live-reload', 'full-page'])
    if (!call.args.includes(expected))
      fail(`Shopify CLI was not started with ${expected}: ${call.args.join(' ')}`, output);
  if (realpathSync(call.cwd) !== realpathSync(consumer) || realpathSync(call.initCwd) !== realpathSync(consumer))
    fail(`Shopify CLI ran in ${call.cwd} (INIT_CWD ${call.initCwd}), not in the theme root.`, output);

  const before = builds();
  appendFileSync(join(consumer, 'frontend', 'entrypoints', 'theme.css'), '\n.editor-smoke { color: rebeccapurple; }\n');
  await until('a rebuild after an edit', () => builds() > before, output);

  if (windows) {
    // Windows has no catchable SIGINT for a child process: stop the whole tree and skip the graceful-stop checks.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    await exited;
  } else {
    child.kill('SIGINT');
    await exited;
    if (!/Stopped\. Generated snippet kept/.test(text())) fail('The footer is missing after the stop.', output);
    if (existsSync(join(consumer, '.vite-shopify-theme.lock')))
      fail('The ownership lock remained after the stop.', output);
  }
  console.log(
    `[editor] ${manager} ran dev --editor from the packed package, rebuilt after an edit, and ${windows ? 'was stopped' : 'stopped cleanly'}.`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
