import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [tailwindcss(), shopifyTheme({
    entries: {
      'theme.css': 'frontend/entrypoints/theme.css',
      'theme.ts': 'frontend/entrypoints/theme.ts',
    },
    themeRoot: '.',
    snippet: 'snippets/vite-tag.liquid',
    devOrigin: process.env.SHOPIFY_VITE_ORIGIN,
  })],
});
