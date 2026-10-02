import { defineConfig } from 'vite';
import { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [shopifyTheme({
    entries: {
      'theme.css': 'frontend/theme.css',
      'theme.ts': 'frontend/theme.ts',
    },
  })],
});
