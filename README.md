# @display-studio/vite-plugin-shopify-theme

[![CI](https://github.com/display-design-studio/vite-plugin-shopify-theme/actions/workflows/ci.yml/badge.svg)](https://github.com/display-design-studio/vite-plugin-shopify-theme/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@display-studio/vite-plugin-shopify-theme)](https://www.npmjs.com/package/@display-studio/vite-plugin-shopify-theme)
[![license](https://img.shields.io/npm/l/@display-studio/vite-plugin-shopify-theme)](./LICENSE)

A zero-runtime-dependency Vite 8 plugin and setup CLI for explicit Shopify theme entries.

## Requirements

- Node.js `^20.19.0 || >=22.12.0`
- Shopify CLI installed as `shopify`
- Vite `^8.0.0` (installed by `init`)

## New theme

1. Create and configure the latest official Shopify Skeleton:

   ```sh
   npx @display-studio/vite-plugin-shopify-theme init my-theme
   ```

2. Enter the project and start Shopify and Vite together:

   ```sh
   cd my-theme
   npm run dev
   ```

## Existing theme

1. From a theme containing `assets`, `layout`, and `snippets`, run:

   ```sh
   npx @display-studio/vite-plugin-shopify-theme init
   ```

2. Start local development with `npm run dev`.

The wizard defaults to TypeScript, the detected package manager (npm otherwise), Tailwind CSS, and Shopify AI Toolkit skills. Pass `--yes` for those defaults or `--no-tailwind` / `--no-skills` to opt out.

## Minimal configuration

```ts
import { defineConfig } from 'vite';
import shopify from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [shopify({
    entries: {
      'theme.css': 'frontend/entrypoints/theme.css',
      'theme.ts': 'frontend/entrypoints/theme.ts',
    },
  })],
});
```

Every entry remains explicit. Generated output is deterministic, stale cleanup is restricted to recorded plugin-owned assets, and manual theme files are preserved.

Read [why this plugin exists](https://display-design-studio.github.io/vite-plugin-shopify-theme/why-this-plugin) and the complete [documentation](https://display-design-studio.github.io/vite-plugin-shopify-theme/) for CLI flags, development modes, configuration, frameworks, advanced workflows, API, and troubleshooting.
