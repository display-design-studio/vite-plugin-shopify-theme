import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [vue(), shopifyTheme({ entries: { 'section.js': 'frontend/entrypoints/section.js' } })],
});
