import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rolldownOptions: { external: [/^node:/, 'vite'] },
    sourcemap: true,
  },
  plugins: [dts({ include: ['src'], entryRoot: 'src' })],
});
