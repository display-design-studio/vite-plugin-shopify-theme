import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { shopifyTheme } from '../src/index.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'shopify-theme-integration-'));
  roots.push(root);
  mkdirSync(join(root, 'frontend'), { recursive: true });
  mkdirSync(join(root, 'snippets'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'frontend/theme.ts'), "import './shared.css'; console.log('theme')");
  writeFileSync(join(root, 'frontend/theme.css'), '.entry { color: red }');
  writeFileSync(join(root, 'frontend/shared.css'), '.shared { color: blue }');
  writeFileSync(join(root, 'snippets/vite-tag.liquid'), 'original production snippet\n');
  writeFileSync(join(root, 'assets/manual.svg'), '<svg/>');
  return root;
}

const entries = { 'theme.css': 'frontend/theme.css', 'theme.ts': 'frontend/theme.ts' };
const statePath = (root: string) => join(root, '.vite-shopify-theme.json');
const snippetPath = (root: string) => join(root, 'snippets/vite-tag.liquid');
const lockPath = (root: string) => join(root, '.vite-shopify-theme.lock');

async function buildTheme(root: string, extraPlugins: any[] = []) {
  return build({ configFile: false, root, logLevel: 'silent', plugins: [shopifyTheme({ entries, themeRoot: root }), ...extraPlugins] });
}

function devServer(root: string, devOrigin?: string) {
  const plugin = shopifyTheme({ entries, themeRoot: root, devOrigin }) as any;
  const contribution = plugin.config({ root }, { command: 'serve', mode: 'development' });
  plugin.configResolved({ command: 'serve' });
  const httpServer = new EventEmitter() as EventEmitter & { address(): { address: string; family: string; port: number } };
  httpServer.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 5173 });
  const server = { config: { server: { host: '127.0.0.1', https: false, ...contribution.server } }, httpServer };
  plugin.configureServer(server);
  return { plugin, contribution, httpServer };
}

describe('isolated builds', () => {
  it('preserves manual assets, removes only stale owned files, and writes deterministic atomic state', async () => {
    const root = fixture();
    writeFileSync(join(root, 'assets/stale.js'), 'stale');
    writeFileSync(statePath(root), `${JSON.stringify({ files: ['stale.js'] }, null, 2)}\n`);
    chmodSync(snippetPath(root), 0o640);
    await buildTheme(root);
    expect(existsSync(join(root, 'assets/manual.svg'))).toBe(true);
    expect(existsSync(join(root, 'assets/stale.js'))).toBe(false);
    expect(statSync(snippetPath(root)).mode & 0o777).toBe(0o640);
    const firstState = readFileSync(statePath(root), 'utf8');
    const firstSnippet = readFileSync(snippetPath(root), 'utf8');
    await buildTheme(root);
    expect(readFileSync(statePath(root), 'utf8')).toBe(firstState);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(firstSnippet);
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(readdirSync(join(root, 'snippets')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it('keeps the last successful assets and snippet after a failed build', async () => {
    const root = fixture();
    await buildTheme(root);
    const state = JSON.parse(readFileSync(statePath(root), 'utf8')) as { files: string[] };
    const snippet = readFileSync(snippetPath(root), 'utf8');
    const files = state.files.map((file) => [file, readFileSync(join(root, 'assets', file), 'utf8')] as const);
    const fail = { name: 'intentional-failure', transform() { throw new Error('intentional build failure'); } };
    await expect(buildTheme(root, [fail])).rejects.toThrow(/intentional build failure/);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(snippet);
    for (const [file, content] of files) expect(readFileSync(join(root, 'assets', file), 'utf8')).toBe(content);
    expect(existsSync(lockPath(root))).toBe(false);
  });
});

describe('development ownership and recovery', () => {
  it('owns before listening, restores on close, and supports restart', () => {
    const root = fixture();
    const original = readFileSync(snippetPath(root), 'utf8');
    const first = devServer(root);
    expect(existsSync(lockPath(root))).toBe(true);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(original);
    first.httpServer.emit('listening');
    expect(readFileSync(snippetPath(root), 'utf8')).toContain('http://127.0.0.1:5173/@vite/client');
    first.plugin.closeServer();
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(original);
    expect(existsSync(lockPath(root))).toBe(false);

    const restarted = devServer(root, 'https://vite.example.test');
    restarted.httpServer.emit('listening');
    expect(restarted.contribution.server.ws).toMatchObject({ protocol: 'wss', host: 'vite.example.test', clientPort: 443 });
    restarted.httpServer.emit('close');
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(original);
  });

  it('rejects live development/build contention with an actionable diagnostic', async () => {
    const root = fixture();
    const active = devServer(root);
    expect(() => devServer(root)).toThrow(new RegExp(`development process ${process.pid}`));
    await expect(buildTheme(root)).rejects.toThrow(new RegExp(`development process ${process.pid}`));
    active.plugin.closeServer();
  });

  it('recovers a dead owner only when the temporary snippet hash still matches', () => {
    const root = fixture();
    const original = readFileSync(snippetPath(root), 'utf8');
    const temporary = 'stale development snippet\n';
    writeFileSync(snippetPath(root), temporary);
    writeStaleLock(root, temporary, original, 'dead');
    const recovered = devServer(root);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe(original);
    recovered.plugin.closeServer();

    writeFileSync(snippetPath(root), 'manual edit\n');
    writeStaleLock(root, temporary, original, 'dead-again');
    const preserved = devServer(root);
    expect(readFileSync(snippetPath(root), 'utf8')).toBe('manual edit\n');
    preserved.plugin.closeServer();
  });
});

function writeStaleLock(root: string, temporary: string, original: string, token: string) {
  mkdirSync(lockPath(root));
  writeFileSync(join(lockPath(root), 'owner.json'), JSON.stringify({
    token, pid: 999_999_999, mode: 'development', startedAt: '2020-01-01T00:00:00.000Z',
    development: {
      snippet: snippetPath(root), developmentHash: createHash('sha256').update(temporary).digest('hex'),
      original: { exists: true, content: original },
    },
  }));
}
