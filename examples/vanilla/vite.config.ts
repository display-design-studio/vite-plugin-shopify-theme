import { defineConfig } from 'vite';
import shopify from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [shopify({
    entries: {
      'theme.css': 'frontend/theme.css',
      'theme.ts': 'frontend/theme.ts',
    },
  })],
});
