import { execFileSync } from 'node:child_process';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const expectedFiles = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'dist/config.d.ts',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/index.js.map',
  'dist/ownership.d.ts',
  'dist/plugin.d.ts',
  'dist/snippets.d.ts',
  'package.json',
];

export const expectedRuntimeExports = [
  'collectManifestTags',
  'default',
  'developmentSnippet',
  'normalizeOptions',
  'productionSnippet',
  'shopifyTheme',
];

const expectedTypeEntrypoint = [
  "export { default, shopifyTheme } from './plugin.js';",
  "export { normalizeOptions } from './config.js';",
  "export type { NormalizedOptions, ShopifyThemeOptions } from './config.js';",
  "export { collectManifestTags, developmentSnippet, productionSnippet } from './snippets.js';",
  "export type { ManifestTags } from './snippets.js';",
  '',
].join('\n');

function stage(name, operation) {
  try {
    return operation();
  } catch (error) {
    throw new Error(`[pack: ${name}] ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function stageAsync(name, operation) {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`[pack: ${name}] ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export function validateFiles(files) {
  deepStrictEqual([...files].sort(), expectedFiles, 'published file list differs from the package contract');
}

export function validateMetadata(manifest) {
  strictEqual(manifest.name, '@display-studio/vite-plugin-shopify-theme', 'package name differs');
  strictEqual(manifest.version, '0.2.1', 'package version differs');
  strictEqual(manifest.type, 'module', 'package must remain ESM');
  strictEqual(manifest.license, 'MIT', 'package license must remain MIT');
  strictEqual(manifest.main, './dist/index.js', 'main entrypoint differs');
  strictEqual(manifest.types, './dist/index.d.ts', 'type entrypoint differs');
  deepStrictEqual(manifest.files, ['dist', 'README.md', 'CHANGELOG.md', 'LICENSE'], 'files allowlist differs');
  deepStrictEqual(manifest.engines, { node: '^20.19.0 || >=22.12.0' }, 'Node engine differs');
  deepStrictEqual(manifest.peerDependencies, { vite: '^8.0.0' }, 'Vite peer range differs');
  strictEqual('bin' in manifest, false, 'package must not publish executables');
  strictEqual('dependencies' in manifest, false, 'package must not declare runtime dependencies');
  deepStrictEqual(manifest.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/' }, 'publish configuration differs');
  strictEqual(manifest.scripts?.prepublishOnly, 'npm run check', 'prepublishOnly guard differs');
  deepStrictEqual(manifest.repository, {
    type: 'git',
    url: 'git+https://github.com/display-design-studio/vite-plugin-shopify-theme.git',
  }, 'repository metadata differs');
  strictEqual(manifest.homepage, 'https://github.com/display-design-studio/vite-plugin-shopify-theme#readme', 'homepage metadata differs');
  deepStrictEqual(manifest.bugs, { url: 'https://github.com/display-design-studio/vite-plugin-shopify-theme/issues' }, 'issue tracker metadata differs');
  for (const keyword of ['vite-plugin', 'shopify', 'liquid', 'hmr']) {
    strictEqual(manifest.keywords?.includes(keyword), true, `required keyword ${JSON.stringify(keyword)} is missing`);
  }
  deepStrictEqual(Object.keys(manifest.exports ?? {}), ['.'], 'only the root package subpath may be exported');
  deepStrictEqual(manifest.exports['.'], {
    types: './dist/index.d.ts',
    import: './dist/index.js',
  }, 'root export map differs');
}

export function validateImport(packageDirectory) {
  const packageName = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')).name;
  const consumer = dirname(dirname(packageDirectory));
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', [
    `import * as module from ${JSON.stringify(packageName)};`,
    'console.log(JSON.stringify({ exports: Object.keys(module).sort(), sameDefault: module.default === module.shopifyTheme }));',
  ].join('\n')], { cwd: consumer, encoding: 'utf8' }));
  deepStrictEqual(result.exports, expectedRuntimeExports, 'runtime export list differs');
  strictEqual(result.sameDefault, true, 'default export must be identical to shopifyTheme');

  const consumerRequire = createRequire(join(consumer, 'package.json'));
  for (const subpath of [`${packageName}/dist/index.js`, `${packageName}/package.json`]) {
    try {
      consumerRequire.resolve(subpath);
    } catch (error) {
      if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') continue;
      throw new Error(`internal subpath ${JSON.stringify(subpath)} failed with ${error?.code ?? 'an unexpected error'}`, { cause: error });
    }
    throw new Error(`internal subpath ${JSON.stringify(subpath)} is importable`);
  }
}

export async function checkPackage() {
  const temporary = mkdtempSync(join(tmpdir(), 'vite-plugin-shopify-theme-pack-'));
  const packDirectory = join(temporary, 'pack');
  const consumer = join(temporary, 'consumer');
  const cache = join(temporary, 'npm-cache');
  mkdirSync(packDirectory);
  mkdirSync(consumer);

  try {
    const pack = stage('pack', () => {
      const raw = execFileSync('npm', ['pack', '--json', '--pack-destination', packDirectory], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: cache, npm_config_dry_run: 'false' },
      });
      const parsed = JSON.parse(raw);
      const result = Array.isArray(parsed)
        ? parsed[0]
        : parsed?.filename
          ? parsed
          : Object.values(parsed ?? {})[0];
      if (!result?.filename || !Array.isArray(result.files)) throw new Error('npm pack returned an invalid manifest');
      validateFiles(result.files.map(({ path }) => path));
      return result;
    });

    writeFileSync(join(consumer, 'package.json'), '{"name":"package-contract-consumer","private":true,"type":"module"}\n');
    stage('install', () => execFileSync('npm', [
      'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
      '--legacy-peer-deps', join(packDirectory, pack.filename),
    ], {
      cwd: consumer,
      stdio: 'pipe',
      env: { ...process.env, npm_config_cache: cache, npm_config_dry_run: 'false' },
    }));

    const packageDirectory = join(consumer, 'node_modules', '@display-studio', 'vite-plugin-shopify-theme');
    stage('metadata', () => {
      if (!existsSync(packageDirectory)) throw new Error('installed package is missing');
      validateMetadata(JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')));
      strictEqual(readFileSync(join(packageDirectory, 'dist', 'index.d.ts'), 'utf8'), expectedTypeEntrypoint,
        'public declaration exports differ');
    });
    await stageAsync('import', () => validateImport(packageDirectory));

    console.log(`Package contract passed: ${pack.files.length} files, ${pack.size} bytes, installed and imported offline.`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  checkPackage().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
