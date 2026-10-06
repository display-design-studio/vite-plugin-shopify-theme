import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import shopify from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [
    react(),
    shopify({ entries: { 'section.js': 'frontend/section.tsx' } }),
  ],
});
