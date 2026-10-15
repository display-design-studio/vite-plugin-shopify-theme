import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
// The first sync build compiles every entry, so it gets longer than the development server's startup.
const syncReadyTimeout = 120_000;

// The plugin records `development` (or, in sync mode, `published`) in the ownership metadata right after writing the snippet.
function ownerReady(timeout: number): NonNullable<DevRuntime['ready']> {
  return async (vite, cwd, closed) => {
    const owner = join(cwd, '.vite-shopify-theme.lock', 'owner.json');
    for (let waited = 0; waited < timeout && !closed(); waited += 100) {
      try {
        const state = JSON.parse(readFileSync(owner, 'utf8'));
        if (state?.pid === vite.pid && (state.development || state.published)) return true;
      } catch { /* not written yet */ }
      await delay(100);
    }
    return false;
  };
}

const environmentConfig = 'shopify.theme.toml';
const developmentEnvironment = /^\s*\[environments\.(?:development|"development")\]\s*(?:#.*)?$/m;

/**
 * Arguments before `--` go to Vite; arguments after it go to `shopify theme dev`.
 * `--sync` (before `--`) selects sync mode: Vite rebuilds on change and Shopify serves the hashed assets.
 */
export function splitDevelopmentArguments(arguments_: string[]) {
  const separator = arguments_.indexOf('--');
  const before = separator === -1 ? arguments_ : arguments_.slice(0, separator);
  return { sync: before.includes('--sync'), vite: before.filter((argument) => argument !== '--sync'), shopify: separator === -1 ? [] as string[] : arguments_.slice(separator + 1) };
}

/**
 * Selects the `development` Shopify CLI environment automatically when `shopify.theme.toml` defines it,
 * unless the caller already chose an environment by flag or SHOPIFY_FLAG_ENVIRONMENT.
 */
export function shopifyThemeArguments(cwd: string, extra: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const chosen = extra.some((argument) => argument === '-e' || argument === '--environment' || argument.startsWith('--environment=')) || Boolean(env.SHOPIFY_FLAG_ENVIRONMENT);
  const file = join(cwd, environmentConfig);
  const automatic = !chosen && existsSync(file) && developmentEnvironment.test(readFileSync(file, 'utf8'));
  return ['theme', 'dev', ...(automatic ? ['--environment', 'development'] : []), ...extra];
}

function shellQuote(argument: string): string {
  return /^[\w@%+=:,./-]+$/.test(argument) ? argument : `"${argument.replace(/"/g, '\\"')}"`;
}

export function runDevelopment(arguments_: string[], runtime: DevRuntime = {}) {
  const { sync, vite: userViteArguments, shopify: shopifyArguments } = splitDevelopmentArguments(arguments_);
  const cwd = resolve(runtime.cwd ?? process.cwd());
  const spawnProcess = runtime.spawn ?? spawn;
  const platform = runtime.platform ?? process.platform;
  const require = createRequire(import.meta.url);
  const vitePackage = require.resolve('vite/package.json');
  const viteBin = join(dirname(vitePackage), JSON.parse(readFileSync(vitePackage, 'utf8')).bin.vite);
  const viteArguments = sync ? ['build', '--watch', ...userViteArguments] : userViteArguments;
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
    const ready = await (runtime.ready ?? ownerReady(sync ? syncReadyTimeout : readyTimeout))(vite, cwd, () => closing);
    if (closing) return;
    if (!ready) console.warn(`vite-shopify-theme: Vite did not ${sync ? 'publish the first build' : 'write the development snippet'} in time; starting Shopify CLI anyway.`);
    const themeArguments = shopifyThemeArguments(cwd, shopifyArguments);
    const shopify = platform === 'win32'
      ? spawnProcess(`shopify ${themeArguments.map(shellQuote).join(' ')}`, { cwd, env: process.env, stdio: 'inherit', shell: true })
      : spawnProcess('shopify', themeArguments, { cwd, env: process.env, stdio: 'inherit' });
    children.push(shopify);
    watch(shopify);
  })();
  return { children, close, started };
}
