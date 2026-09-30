import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['run', 'vite', '--', '--host', '127.0.0.1'], { stdio: 'inherit' }),
  spawn('npx', ['shopify', 'theme', 'dev'], { stdio: 'inherit' }),
];
let closing = false;
function close(signal = 'SIGTERM') {
  if (closing) return;
  closing = true;
  for (const child of children) if (!child.killed) child.kill(signal);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => close(signal));
for (const child of children) child.on('exit', (code) => { close(); process.exitCode = code ?? 1; });
