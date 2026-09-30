import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { shopifyTheme } from '../src/index.js';

const themeRoot = resolve('playground/skeleton-theme');
const critical = resolve(themeRoot, 'assets/critical.css');
const marker = resolve(themeRoot, 'assets/manual-test.svg');
const stale = resolve(themeRoot, 'assets/stale-plugin-file.js');

describe('official Skeleton Theme build', () => {
  afterAll(() => { if (existsSync(marker)) import('node:fs').then(({ unlinkSync }) => unlinkSync(marker)); });

  it('preserves manual assets and replaces only recorded generated assets', async () => {
    const originalCritical = readFileSync(critical, 'utf8');
    writeFileSync(marker, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(stale, 'stale');
    const statePath = resolve(themeRoot, '.vite-shopify-theme.json');
    const prior = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')).files as string[] : [];
    writeFileSync(statePath, JSON.stringify({ files: [...prior, 'stale-plugin-file.js'] }));
    await build({ root: themeRoot, logLevel: 'silent' });
    expect(readFileSync(critical, 'utf8')).toBe(originalCritical);
    expect(existsSync(marker)).toBe(true);
    expect(existsSync(stale)).toBe(false);
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { files: string[] };
    expect(state.files.some((file) => file.endsWith('.js'))).toBe(true);
    expect(state.files.every((file) => !file.includes('/'))).toBe(true);
    const snippet = readFileSync(resolve(themeRoot, 'snippets/vite-tag.liquid'), 'utf8');
    expect(snippet).toContain("{% when 'theme.css' %}");
    expect(snippet).toContain("{% when 'theme.ts' %}");
    const manifest = JSON.parse(readFileSync(resolve(themeRoot, 'assets/vite-manifest.json'), 'utf8')) as Record<string, { file: string; isEntry?: boolean }>;
    expect(Object.values(manifest).filter(({ isEntry }) => isEntry)).toHaveLength(2);
    expect(Object.keys(manifest).filter((key) => key.endsWith('.css'))).toEqual(['frontend/entrypoints/theme.css']);
    expect(Object.keys(manifest).some((key) => key.includes('modules/demo'))).toBe(true);
    const cssEntry = manifest['frontend/entrypoints/theme.css'];
    expect(cssEntry).toBeDefined();
    const emittedCss = readFileSync(resolve(themeRoot, 'assets', cssEntry.file), 'utf8');
    expect(emittedCss).toContain('.underline');
    expect(emittedCss).toContain('--vite-demo-accent:#5c6ac4');
    expect(emittedCss).toContain('[data-vite-demo]');
    expect(emittedCss).not.toContain('box-sizing:border-box');
    expect(snippet).toContain(`'${cssEntry.file}' | asset_url`);
  }, 30_000);

  it('writes local and external dev snippets and restores cleanly', async () => {
    const snippetPath = resolve(themeRoot, 'snippets/vite-tag.liquid');
    const production = readFileSync(snippetPath, 'utf8');
    const entries = { 'theme.css': 'frontend/entrypoints/theme.css', 'theme.ts': 'frontend/entrypoints/theme.ts' };
    const exercise = (devOrigin?: string) => {
      const plugin = shopifyTheme({ entries, themeRoot, devOrigin }) as any;
      const contribution = plugin.config({ root: themeRoot, server: {} }, { command: 'serve', mode: 'development' });
      const httpServer = new EventEmitter() as EventEmitter & { address(): { address: string; family: string; port: number } };
      httpServer.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 5173 });
      const server = { config: { server: { host: '127.0.0.1', https: false, ...contribution.server } }, httpServer };
      plugin.configureServer(server);
      httpServer.emit('listening');
      return { contribution, close: () => plugin.closeServer({ reason: 'close' }) };
    };
    const local = exercise();
    expect(readFileSync(snippetPath, 'utf8')).toMatch(/http:\/\/(localhost|127\.0\.0\.1):\d+\/@vite\/client/);
    local.close();
    expect(readFileSync(snippetPath, 'utf8')).toBe(production);

    const remote = exercise('https://vite.example.test');
    expect(readFileSync(snippetPath, 'utf8')).toContain('https://vite.example.test/@vite/client');
    expect(remote.contribution.server.hmr).toMatchObject({ protocol: 'wss', host: 'vite.example.test', clientPort: 443 });
    expect(remote.contribution.server.allowedHosts).toContain('vite.example.test');
    remote.close();
    expect(readFileSync(snippetPath, 'utf8')).toBe(production);
  }, 30_000);
});
