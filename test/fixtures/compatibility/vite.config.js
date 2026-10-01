import { defineConfig } from 'vite';
import { shopifyTheme } from 'vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [shopifyTheme({
    entries: {
      'theme.css': 'frontend/entrypoints/theme.css',
      'theme.ts': 'frontend/entrypoints/theme.ts',
    },
  })],
});
