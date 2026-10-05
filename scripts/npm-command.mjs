import { execFileSync } from 'node:child_process';

export function execNpmSync(args, options) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    return execFileSync(process.env.npm_node_execpath ?? process.execPath, [npmCli, ...args], options);
  }
  if (process.platform === 'win32') {
    throw new Error('Cannot run npm because npm_execpath is unavailable. Run this script through an npm script so the active npm CLI can be located.');
  }
  return execFileSync('npm', args, options);
}
