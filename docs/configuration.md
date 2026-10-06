# 4. Configuration

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `entries` | `Record<string, string>` | required | Explicit Liquid name to source map. |
| `themeRoot` | `string` | `.` | Shopify theme root. |
| `snippet` | `string` | `snippets/vite-tag.liquid` | Generated Liquid snippet. |
| `devOrigin` | `string` | Vite origin | External HTTPS development origin. |
| `diagnostics` | `boolean` | `false` | Lifecycle diagnostics. |

The plugin owns the theme root, custom app type, explicit build input, `assets` output, manifest name, relative base, disabled public directory, and disabled empty-output cleanup. Conflicting values are rejected. Entry sources must be distinct files within the canonical theme root.

## Complete example

```ts
import { defineConfig } from 'vite';
import shopify from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [shopify({
    themeRoot: './themes/storefront',
    snippet: 'snippets/vite-tag.liquid',
    entries: {
      'theme.css': 'frontend/entrypoints/theme.css',
      'theme.ts': 'frontend/entrypoints/theme.ts',
      'product.ts': 'frontend/entrypoints/product.ts',
    },
    devOrigin: 'https://vite.example.test',
    diagnostics: true,
  })],
});
```

Entry names may contain ASCII letters, digits, dots, underscores, and hyphens and must begin with a letter or digit. Sources must be readable files inside the canonical theme root, including after symlink resolution. A source can belong to only one entry.

`snippet` is relative to `themeRoot`; its parent directory must already exist. `devOrigin` must be an HTTPS origin with no credentials, path, query, or fragment. Enable `diagnostics` when investigating lifecycle behavior; stable messages begin with a `[shopify-theme:CODE]` identifier suitable for issue reports.

The plugin rejects conflicting `root`, `appType`, `base`, `publicDir`, build input, output directory, manifest, and destructive `emptyOutDir` settings instead of silently merging an unsafe configuration.
