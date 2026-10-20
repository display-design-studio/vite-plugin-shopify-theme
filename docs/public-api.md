# Public API

```ts
import shopify, { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';
```

The package exports only its root. The default export and `shopifyTheme` are identical; the default import is canonical. The `vite-shopify-theme` executable is not a JavaScript subpath API, and the package has zero runtime dependencies.

## What is public

| Name | Kind | Notes |
| --- | --- | --- |
| default export, `shopifyTheme` | function | The Vite plugin. |
| `ShopifyThemeOptions` | type | The plugin options; see [Configuration](./configuration). |
| `EntryOptions` | type | The object form of an entry; see [Entry options](./configuration#entry-options). |
| Diagnostic codes | strings | The `[shopify-theme:CODE]` prefix of every message; listed below. |
| `vite-shopify-theme init` and `dev` | CLI | Their documented flags; see [CLI init](./cli-init) and [Development modes](./development-modes). |

A diagnostic code keeps its meaning within a major version. The text after the code is for people and can change in any release, so match on the code, not on the message.

## Deprecated exports

These names are exported from the root by accident. They are internal, they are marked `@deprecated` in the types as of 0.7.0, and they are removed in 1.0.0. If you rely on one, open an issue describing the use before 1.0.0.

| Name | Kind |
| --- | --- |
| `normalizeOptions` | function |
| `NormalizedOptions` | type |
| `collectManifestTags` | function |
| `ManifestTags` | type |
| `developmentSnippet` | function |
| `productionSnippet` | function, also out of date: it cannot render `attributes`, `inline`, or the CSS bundle |

`devOrigin` is deprecated too and is removed in 1.0.0; see [Live Theme Editor](./cookbook/theme-editor-and-tunnels).

## Diagnostic codes

Errors stop the build or the development server. Warnings let it continue.

| Code | Level | Meaning |
| --- | --- | --- |
| `BUILD_CLEANUP_FAILED` | error | A build failed and releasing theme ownership failed as well. |
| `BUILD_CSS_MISSING` | error | The aggregated stylesheet that `build.cssCodeSplit: false` needs was not generated. |
| `BUILD_ROLLBACK_FAILED` | error | A build failed and the previous snippet could not be restored. |
| `CONFIG_CSS_ENTRY_RESERVED` | error | A non-stylesheet entry uses the name reserved for the aggregated stylesheet. |
| `CONFIG_DEV_ORIGIN` | error | `devOrigin` is not an absolute HTTPS origin. |
| `CONFIG_DIAGNOSTICS` | error | `diagnostics` is not a boolean. |
| `CONFIG_ENTRIES` | error | An entry is not a non-empty source path or a valid entry object. |
| `CONFIG_SNIPPET` | error | `snippet` is not a path string relative to `themeRoot`. |
| `CONFIG_THEME_ROOT` | error | `themeRoot` is not a path string. |
| `CONFIG_VITE_CONFLICT` | error | A Vite option the plugin owns, such as `publicDir`, is set in the user config. |
| `DEV_EXTERNAL_ORIGIN` | warning | `devOrigin` is in use: the HTTPS tunnel must stay up and stable. |
| `DEV_ORIGIN_DEPRECATED` | warning | `devOrigin` is deprecated; use `dev --editor`. |
| `DEV_ORIGIN_UNAVAILABLE` | error | The development origin cannot be determined, for example in middleware mode. |
| `DEV_OWNERSHIP_LOST` | error | Theme ownership was lost before the development server started. |
| `FS_JSON_INVALID` | error | A JSON file the plugin reads is not valid JSON. |
| `FS_READ_FAILED` | error | A file could not be read. |
| `FS_REMOVE_FAILED` | error | A plugin-owned file could not be removed. |
| `FS_WRITE_FAILED` | error | A generated file could not be written atomically. |
| `INLINE_CSS_TOO_LARGE` | warning | An `inline` stylesheet is over Shopify's 15 KB limit, so a normal `<link>` is rendered. |
| `LOCK_ACQUIRE_FAILED` | error | Theme ownership could not be acquired after several attempts. |
| `LOCK_ACTIVE` | error | Another live process owns the theme. |
| `LOCK_CHANGED` | error | The ownership lock changed unexpectedly. |
| `LOCK_CREATE_FAILED` | error | The ownership lock directory could not be created. |
| `LOCK_METADATA_INVALID` | error | The lock metadata could not be read or parsed. |
| `LOCK_METADATA_MISSING` | error | The lock directory has no metadata. |
| `LOCK_RECLAIM_FAILED` | error | A stale lock could not be reclaimed. |
| `LOCK_RELEASE_FAILED` | error | The ownership lock could not be released. |
| `MANIFEST_ENTRY_MISSING` | error | The Vite manifest lacks a declared entry. |
| `MANIFEST_IMPORT_MISSING` | error | A manifest entry imports a chunk that the manifest does not contain. |
| `MANIFEST_INVALID` | error | The Vite manifest is not a JSON object. |
| `PATH_MISSING` | error | A required path does not exist. |
| `PATH_OUTSIDE_THEME` | error | A path resolves outside the theme root. |
| `PATH_RESOLUTION_FAILED` | error | A path could not be resolved. |
| `SNIPPET_SIZE_NEAR_LIMIT` | warning | The generated snippet is close to Shopify's 256 kB limit. |
| `STATE_INVALID` | error | The ownership state file has an invalid structure. |
| `THEME_STRUCTURE_INVALID` | error | The theme root lacks an expected directory. |

See [Troubleshooting](./troubleshooting) for what to do about the common ones.
