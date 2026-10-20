import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { formatFooter, formatGitignoreHint, formatHeader, missingGeneratedPatterns, outputStyle } from './output.js';

export interface DevRuntime {
  cwd?: string;
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
  /** Plugin version shown in the header; the header is skipped when it is not provided. */
  version?: string;
  /** Where header and footer go; defaults to stdout. */
  write?: (text: string) => void;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  /** Resolves true once Vite has written the development snippet; false when it did not in time. */
  ready?: (vite: ChildProcess, cwd: string, closed: () => boolean) => Promise<boolean>;
}

const readyTimeout = 30_000;
const editorReadyTimeout = 120_000;

async function waitForOwner(
  vite: ChildProcess,
  cwd: string,
  closed: () => boolean,
  timeout: number,
  ready: (state: any) => boolean,
) {
  const owner = join(cwd, '.vite-shopify-theme.lock', 'owner.json');
  for (let waited = 0; waited < timeout && !closed(); waited += 100) {
    try {
      const state = JSON.parse(readFileSync(owner, 'utf8'));
      if (state?.pid === vite.pid && ready(state)) return true;
    } catch {
      /* not written yet */
    }
    await delay(100);
  }
  return false;
}

// The plugin records `development` in the ownership metadata right after writing the snippet.
const snippetReady = (vite: ChildProcess, cwd: string, closed: () => boolean) =>
  waitForOwner(vite, cwd, closed, readyTimeout, (state) => Boolean(state.development));
// In watch mode it records a `generation` after each completed build.
const buildReady = (vite: ChildProcess, cwd: string, closed: () => boolean) =>
  waitForOwner(vite, cwd, closed, editorReadyTimeout, (state) => state.generation >= 1);

const environmentConfig = 'shopify.theme.toml';
const developmentEnvironment = /^\s*\[environments\.(?:development|"development")\]\s*(?:#.*)?$/m;

/** Arguments before `--` go to Vite (except `--editor` and `--raw`); arguments after it go to `shopify theme dev`. */
export function splitDevelopmentArguments(arguments_: string[]) {
  const separator = arguments_.indexOf('--');
  const before = separator === -1 ? arguments_ : arguments_.slice(0, separator);
  return {
    vite: before.filter((argument) => argument !== '--editor' && argument !== '--raw'),
    shopify: separator === -1 ? ([] as string[]) : arguments_.slice(separator + 1),
    editor: before.includes('--editor'),
    raw: before.includes('--raw'),
  };
}

function flagValue(arguments_: string[], names: string[]): string | undefined {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    const inline = names.find((name) => argument.startsWith(`${name}=`));
    if (inline) return argument.slice(inline.length + 1);
    if (names.includes(argument) && arguments_[index + 1] !== undefined) return arguments_[index + 1];
  }
  return undefined;
}

/** The store and environment Shopify CLI will use, read the same way the command selects the environment. */
export function describeTarget(
  cwd: string,
  themeArguments: string[],
  env: NodeJS.ProcessEnv = process.env,
): { store?: string; environment?: string } {
  const environment = flagValue(themeArguments, ['--environment', '-e']) ?? env.SHOPIFY_FLAG_ENVIRONMENT;
  let store = flagValue(themeArguments, ['--store', '-s']) ?? env.SHOPIFY_FLAG_STORE;
  const file = join(cwd, environmentConfig);
  if (!store && environment && existsSync(file)) {
    let inside = false;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const table = /^\s*\[(.+?)\]\s*(?:#.*)?$/.exec(line);
      if (table) {
        inside = table[1]!.replace(/"/g, '').trim() === `environments.${environment}`;
        continue;
      }
      const match = inside ? /^\s*store\s*=\s*["']([^"']+)["']/.exec(line) : null;
      if (match) {
        store = match[1];
        break;
      }
    }
  }
  return { ...(store ? { store } : {}), ...(environment ? { environment } : {}) };
}

function shopifyCliVersion(cwd: string): string | undefined {
  try {
    const local = createRequire(join(cwd, 'package.json')).resolve('@shopify/cli/package.json');
    return JSON.parse(readFileSync(local, 'utf8')).version;
  } catch {
    return undefined;
  }
}

/**
 * Selects the `development` Shopify CLI environment automatically when `shopify.theme.toml` defines it,
 * unless the caller already chose an environment by flag or SHOPIFY_FLAG_ENVIRONMENT. In editor mode Shopify CLI
 * reloads the full page after each sync, unless the caller chose a live-reload mode.
 */
export function shopifyThemeArguments(
  cwd: string,
  extra: string[],
  env: NodeJS.ProcessEnv = process.env,
  editor = false,
): string[] {
  const chosen =
    extra.some(
      (argument) => argument === '-e' || argument === '--environment' || argument.startsWith('--environment='),
    ) || Boolean(env.SHOPIFY_FLAG_ENVIRONMENT);
  const file = join(cwd, environmentConfig);
  const automatic = !chosen && existsSync(file) && developmentEnvironment.test(readFileSync(file, 'utf8'));
  const reloadChosen =
    extra.some((argument) => argument === '--live-reload' || argument.startsWith('--live-reload=')) ||
    Boolean(env.SHOPIFY_FLAG_LIVE_RELOAD);
  return [
    'theme',
    'dev',
    ...(automatic ? ['--environment', 'development'] : []),
    ...(editor && !reloadChosen ? ['--live-reload', 'full-page'] : []),
    ...extra,
  ];
}

function shellQuote(argument: string): string {
  return /^[\w@%+=:,./-]+$/.test(argument) ? argument : `"${argument.replace(/"/g, '\\"')}"`;
}

export function runDevelopment(arguments_: string[], runtime: DevRuntime = {}) {
  const { vite: viteArguments, shopify: shopifyArguments, editor, raw } = splitDevelopmentArguments(arguments_);
  const cwd = resolve(runtime.cwd ?? process.cwd());
  const spawnProcess = runtime.spawn ?? spawn;
  const platform = runtime.platform ?? process.platform;
  const env = runtime.env ?? process.env;
  const write =
    runtime.write ??
    ((text: string) => {
      process.stdout.write(text);
    });
  const require = createRequire(import.meta.url);
  const vitePackage = require.resolve('vite/package.json');
  const viteManifest = JSON.parse(readFileSync(vitePackage, 'utf8'));
  const viteBin = join(dirname(vitePackage), viteManifest.bin.vite);
  const themeArguments = shopifyThemeArguments(cwd, shopifyArguments, env, editor);
  const style = outputStyle(env, runtime.isTTY ?? Boolean(process.stdout.isTTY));
  // Everything the header shows is already known here, so printing it adds no waiting before the first spawn.
  const shopifyVersion = shopifyCliVersion(cwd);
  const decorate = !raw && Boolean(runtime.version);
  if (decorate) {
    // One small read: in a watch session Tailwind rebuilds in a loop when generated files are not ignored.
    const gitignore = join(cwd, '.gitignore');
    const hint = editor
      ? formatGitignoreHint(
          missingGeneratedPatterns(existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : undefined),
          style,
        )
      : '';
    write(
      formatHeader(
        {
          version: runtime.version!,
          mode: editor ? 'editor' : 'hmr',
          vite: viteManifest.version,
          node: process.version,
          shopify: shopifyVersion,
          ...describeTarget(cwd, themeArguments, env),
          liveReload: flagValue(themeArguments, ['--live-reload']),
          themePath: flagValue(themeArguments, ['--path']) ?? env.SHOPIFY_FLAG_PATH,
        },
        style,
      ) + hint,
    );
  }
  // Editor mode builds and syncs hashed assets instead of serving them from the dev server.
  // Vite's banner, URLs, and per-build tables repeat what the header and the plugin's build lines already say.
  // Warnings and errors still print, and the plugin writes its own lines to stdout when it runs under this command.
  const quiet =
    !raw &&
    !viteArguments.some(
      (argument) => argument === '-l' || argument === '--logLevel' || argument.startsWith('--logLevel='),
    );
  const vite = spawnProcess(
    process.execPath,
    [viteBin, ...(editor ? ['build', '--watch'] : []), ...viteArguments, ...(quiet ? ['--logLevel', 'warn'] : [])],
    { cwd, stdio: 'inherit', ...(quiet ? { env: { ...env, VITE_SHOPIFY_THEME_CLI: '1' } } : {}) },
  );
  const children: ChildProcess[] = [vite];
  let closing = false;
  const close = (signal: NodeJS.Signals = 'SIGTERM') => {
    if (closing) return;
    closing = true;
    for (const child of children) if (!child.killed) child.kill(signal);
  };
  const listen = runtime.onSignal ?? ((signal, handler) => process.once(signal, handler));
  let stopRequested = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    listen(signal, () => {
      stopRequested = true;
      close(signal);
    });
  const alive = new Set<ChildProcess>();
  let footerPrinted = false;
  const finish = (child: ChildProcess) => {
    alive.delete(child);
    if (raw || !runtime.version || footerPrinted || alive.size > 0 || !closing) return;
    footerPrinted = true;
    write(
      formatFooter(
        {
          mode: editor ? 'editor' : 'hmr',
          lockRemains: existsSync(join(cwd, '.vite-shopify-theme.lock')),
          exitCode: !stopRequested && typeof process.exitCode === 'number' ? process.exitCode : undefined,
        },
        style,
      ),
    );
  };
  const watch = (child: ChildProcess) => {
    alive.add(child);
    child.once('error', (error) => {
      console.error(error.message);
      process.exitCode = 1;
      close();
      finish(child);
    });
    child.once('exit', (code, signal) => {
      process.exitCode ??= code ?? (signal ? 1 : 0);
      close(signal ?? 'SIGTERM');
      finish(child);
    });
  };
  watch(vite);
  // Shopify CLI snapshots local files at startup, so it must start after the snippet (and, in editor mode, the first build) exists.
  const started = (async () => {
    const ready = await (runtime.ready ?? (editor ? buildReady : snippetReady))(vite, cwd, () => closing);
    if (closing) return;
    if (!ready)
      console.warn(
        `vite-shopify-theme: Vite did not write the ${editor ? 'first build' : 'development snippet'} within ${(editor ? editorReadyTimeout : readyTimeout) / 1000}s; starting Shopify CLI anyway.`,
      );
    // Shopify CLI resolves its working directory from npm's INIT_CWD before the real one, so a script started
    // from another directory (a workspace root, `npm --prefix`) would make it look for the theme and
    // shopify.theme.toml there. An explicit --path or SHOPIFY_FLAG_PATH still wins inside Shopify CLI.
    const shopifyEnv = { ...env, INIT_CWD: cwd };
    const shopify =
      platform === 'win32'
        ? spawnProcess(`shopify ${themeArguments.map(shellQuote).join(' ')}`, {
            cwd,
            env: shopifyEnv,
            stdio: 'inherit',
            shell: true,
          })
        : spawnProcess('shopify', themeArguments, { cwd, env: shopifyEnv, stdio: 'inherit' });
    children.push(shopify);
    watch(shopify);
  })();
  return { children, close, started };
}
