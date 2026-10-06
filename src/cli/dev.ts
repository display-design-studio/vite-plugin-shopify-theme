import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

export interface DevRuntime {
  cwd?: string;
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
}

export function runDevelopment(viteArguments: string[], runtime: DevRuntime = {}) {
  const cwd = resolve(runtime.cwd ?? process.cwd());
  const spawnProcess = runtime.spawn ?? spawn;
  const platform = runtime.platform ?? process.platform;
  const require = createRequire(import.meta.url);
  const vitePackage = require.resolve('vite/package.json');
  const viteBin = join(dirname(vitePackage), JSON.parse(readFileSync(vitePackage, 'utf8')).bin.vite);
  const children: ChildProcess[] = [
    spawnProcess(process.execPath, [viteBin, ...viteArguments], { cwd, stdio: 'inherit' }),
    platform === 'win32'
      ? spawnProcess('shopify theme dev', { cwd, env: process.env, stdio: 'inherit', shell: true })
      : spawnProcess('shopify', ['theme', 'dev'], { cwd, env: process.env, stdio: 'inherit' }),
  ];
  let closing = false;
  const close = (signal: NodeJS.Signals = 'SIGTERM') => {
    if (closing) return;
    closing = true;
    for (const child of children) if (!child.killed) child.kill(signal);
  };
  const listen = runtime.onSignal ?? ((signal, handler) => process.once(signal, handler));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) listen(signal, () => close(signal));
  for (const child of children) {
    child.once('error', (error) => { console.error(error.message); process.exitCode = 1; close(); });
    child.once('exit', (code, signal) => { process.exitCode ??= code ?? (signal ? 1 : 0); close(signal ?? 'SIGTERM'); });
  }
  return { children, close };
}
