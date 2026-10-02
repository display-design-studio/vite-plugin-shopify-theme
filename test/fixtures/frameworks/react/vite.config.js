import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [react(), shopifyTheme({ entries: { 'section.jsx': 'frontend/entrypoints/section.jsx' } })],
});
