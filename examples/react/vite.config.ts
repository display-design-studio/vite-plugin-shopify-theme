import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [
    react(),
    shopifyTheme({ entries: { 'section.js': 'frontend/section.tsx' } }),
  ],
});
