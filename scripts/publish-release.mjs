import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execNpmSync } from './npm-command.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const temporary = mkdtempSync(join(tmpdir(), 'vite-plugin-shopify-theme-release-'));
try {
  const packed = JSON.parse(execNpmSync(['pack', '--json', '--pack-destination', temporary], { encoding: 'utf8' }))[0];
  if (!packed?.filename) throw new Error('npm pack did not report a release artifact.');
  const tarball = join(temporary, packed.filename);
  const localIntegrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  let registryIntegrity;
  try {
    registryIntegrity = execNpmSync(['view', `${manifest.name}@${manifest.version}`, 'dist.integrity'], { encoding: 'utf8' }).trim();
  } catch (error) {
    const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
    if (!/E404|not found/i.test(output)) throw error;
  }
  if (registryIntegrity) {
    if (registryIntegrity !== localIntegrity) throw new Error(`Registry integrity differs for ${manifest.name}@${manifest.version}; refusing to treat this rerun as published.`);
    console.log(`${manifest.name}@${manifest.version} already exists with matching integrity; publication skipped.`);
  } else {
    execNpmSync(['publish', tarball, '--access', 'public'], { stdio: 'inherit' });
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
