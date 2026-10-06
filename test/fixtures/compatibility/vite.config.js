import { defineConfig } from 'vite';
import shopify from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [shopify({
    entries: {
      'theme.css': 'frontend/entrypoints/theme.css',
      'theme.ts': 'frontend/entrypoints/theme.ts',
    },
  })],
});
