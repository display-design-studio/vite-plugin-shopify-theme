import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { commands, installConsumer, run, selectManager } from './consumer-support.mjs';

const manager = selectManager(process.argv[2]);

const { temporary, consumer } = installConsumer(manager, 'consumer');
try {
  run(manager, commands[manager].build, consumer, temporary);
  const imported = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          "import plugin, { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';",
          'console.log(JSON.stringify({ same: plugin === shopifyTheme, type: typeof plugin }));',
        ].join('\n'),
      ],
      { cwd: consumer, encoding: 'utf8' },
    ),
  );
  if (!imported.same || imported.type !== 'function')
    throw new Error('The installed public API did not import correctly.');
  const installedPackage = join(consumer, 'node_modules', '@display-studio', 'vite-plugin-shopify-theme');
  const cliHelp = execFileSync(process.execPath, [join(installedPackage, 'dist', 'cli.js'), '--help'], {
    cwd: consumer,
    encoding: 'utf8',
  });
  if (!cliHelp.includes('vite-shopify-theme init') || !cliHelp.includes('vite-shopify-theme dev'))
    throw new Error('The installed executable is unavailable.');
  const installedBin = join(
    consumer,
    'node_modules',
    '.bin',
    `vite-shopify-theme${process.platform === 'win32' ? '.cmd' : ''}`,
  );
  const binHelp = execFileSync(installedBin, ['--help'], {
    cwd: consumer,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (!binHelp.includes('vite-shopify-theme init') || !binHelp.includes('vite-shopify-theme dev'))
    throw new Error('The package-manager executable shim is unavailable.');
  const assets = join(consumer, 'assets');
  const manifest = JSON.parse(readFileSync(join(assets, 'vite-manifest.json'), 'utf8'));
  for (const source of ['frontend/entrypoints/theme.css', 'frontend/entrypoints/theme.ts']) {
    if (!manifest[source]?.file || !existsSync(join(assets, manifest[source].file)))
      throw new Error(`Missing generated output for ${source}.`);
  }
  const snippet = readFileSync(join(consumer, 'snippets', 'vite-tag.liquid'), 'utf8');
  if (!snippet.includes("{% when 'theme.css' %}") || !snippet.includes("{% when 'theme.ts' %}"))
    throw new Error('Generated snippet is missing explicit entries.');
  if (!existsSync(join(assets, 'manual.txt')) || !existsSync(join(consumer, 'snippets', 'manual.liquid')))
    throw new Error('A manual theme file was not preserved.');
  const generated = readdirSync(assets).filter((file) => /\.(?:css|js)$/.test(file));
  if (generated.length < 2) throw new Error('Expected generated CSS and JavaScript assets.');
  console.log(`[consumer] ${manager} installed, imported, executed, and built the packed package successfully.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
