import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('Cannot start Vite because npm_execpath is unavailable. Run this script through npm run dev.');
}
const themeRoot = fileURLToPath(new URL('..', import.meta.url));
const shopifyOptions = {
  cwd: themeRoot,
  env: { ...process.env, SHOPIFY_FLAG_PATH: themeRoot },
  stdio: 'inherit',
};

const children = [
  spawn(process.env.npm_node_execpath ?? process.execPath, [npmCli, 'run', 'vite', '--', '--host', '127.0.0.1'], {
    cwd: themeRoot,
    stdio: 'inherit',
  }),
  process.platform === 'win32'
    ? spawn('shopify theme dev', { ...shopifyOptions, shell: true })
    : spawn('shopify', ['theme', 'dev'], shopifyOptions),
];
let closing = false;
function close(signal = 'SIGTERM') {
  if (closing) return;
  closing = true;
  for (const child of children) if (!child.killed) child.kill(signal);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => close(signal));
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    close();
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    close();
    process.exitCode ??= code ?? 1;
  });
}
