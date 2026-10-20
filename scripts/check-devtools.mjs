// Smoke test for `vite-shopify-theme dev` together with @display-studio/vite-plugin-shopify-devtools, using the packed
// package, the published devtools plugin, and a stand-in `shopify` command. The two plugins are meant to run side by
// side: Shopify CLI must start with the devtools theme mirror already present, and on SIGINT and SIGTERM the mirror and
// the ownership lock must be gone when the process exits. No store or credentials are involved.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { commands, installConsumer, run, selectManager } from './consumer-support.mjs';
import { fail, until, writeStandInShopify } from './smoke-support.mjs';

const manager = selectManager(process.argv[2]);
const windows = process.platform === 'win32';
const devtoolsRange = process.env.DEVTOOLS_VERSION ?? '^0.5.0';
const { temporary, consumer } = installConsumer(manager, 'devtools');

async function session(signal, bin, record) {
  const cli = join(consumer, 'node_modules', '@display-studio', 'vite-plugin-shopify-theme', 'dist', 'cli.js');
  const mirror = join(consumer, '.shopify-devtools', 'theme');
  const output = [];
  if (existsSync(record)) unlinkSync(record);
  const child = spawn(process.execPath, [cli, 'dev', '--', '--live-reload', 'full-page'], {
    cwd: consumer,
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      NO_COLOR: '1',
      SHOPIFY_FLAG_PATH: '.shopify-devtools/theme',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const text = () => output.join('');

  await until('Shopify CLI to start', () => existsSync(record), output);
  const call = JSON.parse(readFileSync(record, 'utf8'));
  if (call.themePathExists !== true)
    fail(
      'Shopify CLI started before the devtools mirror existed (SHOPIFY_FLAG_PATH points at a missing folder).',
      output,
    );
  if (!existsSync(join(mirror, 'layout'))) fail('The devtools mirror is empty or incomplete while Vite runs.', output);
  if (!text().includes('theme     .shopify-devtools/theme')) fail('The header does not show the theme folder.', output);
  if (text().includes('does not exist'))
    fail('A missing-folder warning was printed although the mirror exists.', output);

  if (windows) {
    // Windows has no catchable signal for a child process: stop the whole tree and skip the graceful-stop checks.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    await exited;
    return;
  }
  child.kill(signal);
  await exited;
  if (existsSync(mirror)) fail(`The devtools mirror was still on disk after ${signal}.`, output);
  if (existsSync(join(consumer, '.vite-shopify-theme.lock')))
    fail(`The ownership lock remained after ${signal}.`, output);
  if (!text().includes('Stopped.')) fail(`The footer is missing after ${signal}.`, output);
}

try {
  run(
    manager,
    [...commands[manager].install, `@display-studio/vite-plugin-shopify-devtools@${devtoolsRange}`],
    consumer,
    temporary,
  );
  writeFileSync(
    join(consumer, 'vite.config.js'),
    [
      "import { defineConfig } from 'vite';",
      "import shopify from '@display-studio/vite-plugin-shopify-theme';",
      "import shopifyDevtools, { shopifyDevtoolsConfig } from '@display-studio/vite-plugin-shopify-devtools';",
      'export default defineConfig({',
      '  devtools: shopifyDevtoolsConfig,',
      "  plugins: [shopify({ entries: { 'theme.css': 'frontend/entrypoints/theme.css', 'theme.ts': 'frontend/entrypoints/theme.ts' } }), shopifyDevtools({ instrument: 'copy' })],",
      '});',
      '',
    ].join('\n'),
  );
  writeFileSync(join(consumer, 'shopify.theme.toml'), '[environments.development]\nstore = "smoke.myshopify.com"\n');
  const record = join(temporary, 'shopify-call.json');
  const bin = writeStandInShopify(temporary, record);
  for (const signal of windows ? ['SIGINT'] : ['SIGINT', 'SIGTERM']) await session(signal, bin, record);
  const generated = readdirSync(consumer).filter(
    (name) => name.startsWith('.shopify-devtools') || name.startsWith('.vite-shopify'),
  );
  console.log(
    `[devtools] ${manager} ran dev with the theme and devtools plugins together: Shopify CLI started with the mirror present, and ${windows ? 'the process was stopped' : 'the mirror and the lock were gone after SIGINT and SIGTERM'} (${generated.join(', ')}).`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
