import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import shopify from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [react(), shopify({ entries: { 'section.jsx': 'frontend/entrypoints/section.jsx' } })],
});
