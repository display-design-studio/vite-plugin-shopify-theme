import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import shopify from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [vue(), shopify({ entries: { 'section.js': 'frontend/entrypoints/section.js' } })],
});
