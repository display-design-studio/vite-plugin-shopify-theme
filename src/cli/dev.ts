import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

export interface DevRuntime {
  cwd?: string;
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
  /** Resolves true once Vite has written the development snippet; false when it did not in time. */
  ready?: (vite: ChildProcess, cwd: string, closed: () => boolean) => Promise<boolean>;
}

const readyTimeout = 30_000;

// The plugin records `development` in the ownership metadata right after writing the snippet.
async function snippetReady(vite: ChildProcess, cwd: string, closed: () => boolean) {
  const owner = join(cwd, '.vite-shopify-theme.lock', 'owner.json');
  for (let waited = 0; waited < readyTimeout && !closed(); waited += 100) {
    try {
      const state = JSON.parse(readFileSync(owner, 'utf8'));
      if (state?.pid === vite.pid && state.development) return true;
    } catch { /* not written yet */ }
    await delay(100);
  }
  return false;
}

export function runDevelopment(viteArguments: string[], runtime: DevRuntime = {}) {
  const cwd = resolve(runtime.cwd ?? process.cwd());
  const spawnProcess = runtime.spawn ?? spawn;
  const platform = runtime.platform ?? process.platform;
  const require = createRequire(import.meta.url);
  const vitePackage = require.resolve('vite/package.json');
  const viteBin = join(dirname(vitePackage), JSON.parse(readFileSync(vitePackage, 'utf8')).bin.vite);
  const vite = spawnProcess(process.execPath, [viteBin, ...viteArguments], { cwd, stdio: 'inherit' });
  const children: ChildProcess[] = [vite];
  let closing = false;
  const close = (signal: NodeJS.Signals = 'SIGTERM') => {
    if (closing) return;
    closing = true;
    for (const child of children) if (!child.killed) child.kill(signal);
  };
  const listen = runtime.onSignal ?? ((signal, handler) => process.once(signal, handler));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) listen(signal, () => close(signal));
  const watch = (child: ChildProcess) => {
    child.once('error', (error) => { console.error(error.message); process.exitCode = 1; close(); });
    child.once('exit', (code, signal) => { process.exitCode ??= code ?? (signal ? 1 : 0); close(signal ?? 'SIGTERM'); });
  };
  watch(vite);
  // Shopify CLI snapshots local files at startup, so it must start after the snippet exists.
  const started = (async () => {
    const ready = await (runtime.ready ?? snippetReady)(vite, cwd, () => closing);
    if (closing) return;
    if (!ready) console.warn(`vite-shopify-theme: Vite did not write the development snippet within ${readyTimeout / 1000}s; starting Shopify CLI anyway.`);
    const shopify = platform === 'win32'
      ? spawnProcess('shopify theme dev', { cwd, env: process.env, stdio: 'inherit', shell: true })
      : spawnProcess('shopify', ['theme', 'dev'], { cwd, env: process.env, stdio: 'inherit' });
    children.push(shopify);
    watch(shopify);
  })();
  return { children, close, started };
}
