# 4. Configuration

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `entries` | `Record<string, string>` | required | Explicit Liquid name to source map. |
| `themeRoot` | `string` | `.` | Shopify theme root. |
| `snippet` | `string` | `snippets/vite-tag.liquid` | Generated Liquid snippet. |
| `devOrigin` | `string` | Vite origin | External HTTPS development origin. |
| `diagnostics` | `boolean` | `false` | Lifecycle diagnostics. |

The plugin owns the theme root, custom app type, explicit build input, `assets` output, manifest name, relative base, disabled public directory, and disabled empty-output cleanup. Conflicting values are rejected. Entry sources must be distinct files within the canonical theme root.
