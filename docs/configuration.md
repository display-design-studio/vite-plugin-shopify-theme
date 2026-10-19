# 4. Configuration

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `entries` | `Record<string, string \| EntryOptions>` | required | Explicit Liquid name to source map. A string is shorthand for `{ source }`; see [Entry options](#entry-options). |
| `themeRoot` | `string` | `.` | Shopify theme root. |
| `snippet` | `string` | `snippets/vite-tag.liquid` | Generated Liquid snippet. |
| `devOrigin` | `string` | Vite origin | **Deprecated**, removed in 1.0.0. External HTTPS development origin; use `dev --editor` instead. |
| `diagnostics` | `boolean` | `false` | Lifecycle diagnostics. |

The plugin owns the theme root, custom app type, explicit build input, `assets` output, manifest name, relative base, disabled public directory, and disabled empty-output cleanup. Conflicting values are rejected. Entry sources must be distinct files within the canonical theme root.

## Entry options

An entry value is either a source path or an object:

```ts
shopify({
  entries: {
    'theme.css': { source: 'frontend/entrypoints/theme.css', inline: true },
    'theme.ts': { source: 'frontend/entrypoints/theme.ts', attributes: { fetchpriority: 'high' } },
    'product.ts': 'frontend/entrypoints/product.ts',
  },
});
```

| Option | Type | Purpose |
| --- | --- | --- |
| `source` | `string` | Source file relative to `themeRoot`. Required in the object form. |
| `attributes` | `Record<string, string \| true>` | Extra attributes for this entry's generated script and stylesheet tags. `true` renders a boolean attribute. |
| `inline` | `boolean` | Stylesheet entries only: render the built CSS inline in production. |

**Attributes** apply to the entry's `<script>` and stylesheet `<link>` tags in production and development, rendered sorted by name and HTML-escaped. Preload links do not receive them. Names use lowercase letters, digits, and hyphens. The plugin owns `src`, `href`, `rel`, `type`, `integrity`, and `crossorigin`, and rejects those and any name starting with `on`. String values cannot contain Liquid delimiters or control characters. Invalid options fail at configuration time with `CONFIG_ENTRIES`.

**Inline** renders `<style>{{ 'file.css' | inline_asset_content }}</style>` in production, so the stylesheet costs no request. Shopify only inlines assets smaller than 15 KB. A larger stylesheet produces an `INLINE_CSS_TOO_LARGE` warning and a normal `<link>`; the build does not fail. Development keeps the Vite `<link>` so HMR works, and `inline` is ignored when `build.cssCodeSplit` is `false`. See [Critical CSS](./cookbook/critical-css).

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

`snippet` is relative to `themeRoot`; its parent directory must already exist. `devOrigin` is deprecated and removed in 1.0.0 (see the [Live Theme Editor](./cookbook/theme-editor-and-tunnels) recipe); until then it must be an HTTPS origin with no credentials, path, query, or fragment, and Vite prints a `DEV_ORIGIN_DEPRECATED` warning. Enable `diagnostics` when investigating lifecycle behavior; stable messages begin with a `[shopify-theme:CODE]` identifier suitable for issue reports.

The plugin rejects conflicting `root`, `appType`, `base`, `publicDir`, build input, output directory, manifest, and destructive `emptyOutDir` settings instead of silently merging an unsafe configuration.
