import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  env: { ...process.env, npm_config_cache: join(tmpdir(), 'vite-plugin-shopify-theme-npm-cache') },
});
const [pack] = JSON.parse(raw);
const allowed = /^(package\.json|README\.md|LICENSE|dist\/)/;
const unexpected = pack.files.map(({ path }) => path).filter((path) => !allowed.test(path));
if (unexpected.length) throw new Error(`Unexpected packed files: ${unexpected.join(', ')}`);
console.log(`Package contains ${pack.files.length} expected files (${pack.size} bytes).`);
