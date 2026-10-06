import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  define: { __PACKAGE_VERSION__: JSON.stringify(version) },
  build: {
    lib: { entry: { index: 'src/index.ts', cli: 'src/cli.ts' }, formats: ['es'] },
    rolldownOptions: { external: [/^node:/, 'vite'] },
    sourcemap: true,
  },
  plugins: [dts({ include: ['src'], entryRoot: 'src' })],
});
