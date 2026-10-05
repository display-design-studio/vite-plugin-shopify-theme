# @display-studio/vite-plugin-shopify-theme

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Build][build-src]][build-href]

A zero-runtime-dependency Vite 8 plugin that builds explicit frontend entries into a Shopify theme's `assets` directory and generates a Liquid snippet for production and development.

## Quick start

From an existing Shopify theme root, install Vite and the plugin:

```sh
npm install --save-dev vite @display-studio/vite-plugin-shopify-theme
```

Create the two source files used below:

```text
frontend/entrypoints/theme.css
frontend/entrypoints/theme.ts
```

Create `vite.config.ts`. Every entry is explicit: the key is passed from Liquid and the value is its source path relative to the theme root.

```ts
import { defineConfig } from 'vite';
import { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [shopifyTheme({
    entries: {
      'theme.css': 'frontend/entrypoints/theme.css',
      'theme.ts': 'frontend/entrypoints/theme.ts',
    },
  })],
});
```

Render the generated snippet in `layout/theme.liquid`. The entryless render installs the Vite clients only during development:

```liquid
<head>
  {% render 'vite-tag' %}
  {% render 'vite-tag', entry: 'theme.css' %}
</head>
<body>
  {{ content_for_layout }}
  {% render 'vite-tag', entry: 'theme.ts' %}
</body>
```

Add the scripts and build once to generate `snippets/vite-tag.liquid` and the production assets:

```json
{
  "scripts": {
    "build": "vite build",
    "dev": "vite"
  }
}
```

```sh
npm run build
```

For local development, run `npm run dev` and `shopify theme dev` in separate terminals. See [Development modes](#development-modes) before using Shopify's hosted Theme Editor.

Runnable [Vanilla, Vue, and React examples](examples) use the same layout and build contract.

## Requirements

- Node.js `^20.19.0 || >=22.12.0`.
- Vite `^8.0.0` in the consuming project.
- A Shopify theme directory containing the usual `assets`, `layout`, and `snippets` directories. Shopify CLI is useful for local theme previews, but is not a plugin dependency.

The entryless render emits nothing in production, so it is safe to leave it in the layout. Use `themeRoot`, `snippet`, and `devOrigin` only when their non-default behavior is needed.

## Why this plugin?

A hand-written Vite configuration can emit files into `assets`, but it must also keep Liquid tags synchronized with Vite's manifest and safely coordinate development and production state. This plugin provides that Shopify-specific lifecycle while leaving compilation to Vite.

| Concern | Manual Vite integration | This plugin |
| --- | --- | --- |
| Entry selection | Custom Rollup/Rolldown configuration | Explicit Liquid name/source map |
| Production Liquid | Custom manifest parsing | Deterministic generated snippet |
| Development | Manually maintained Vite and HMR tags | Temporary snippet with Vite HMR and theme reload |
| Stale assets | Custom cleanup, often broad | Removes only previously recorded plugin-owned files |
| Concurrent processes | Project-specific coordination | Theme-root lock and crash recovery |
| Runtime cost | Depends on the implementation | Zero runtime dependencies |

The package is intentionally narrow: it does not discover entries, run Shopify CLI, manage tunnels, deploy themes, or replace framework plugins.

## Configuration

| Option | Type | Default | Contract and behavior |
| --- | --- | --- | --- |
| `entries` | `Record<string, string>` | Required | A non-empty map of Liquid entry names to source files. Names must match `[A-Za-z0-9][A-Za-z0-9._-]*`; sources must be distinct existing files inside `themeRoot`. This map is authoritative and is not supplemented by entry discovery. |
| `themeRoot` | `string` | `.` | Theme directory, resolved from Vite's configured `root` when present, otherwise from the current working directory, and canonicalized through its real path. Entries, the snippet, `assets`, ownership state, and the process lock are scoped to this directory. |
| `snippet` | `string` | `snippets/vite-tag.liquid` | Generated Liquid file, resolved relative to and required to remain inside `themeRoot`. Render the corresponding snippet name from Liquid. The file is generated on build and temporarily replaced during development. |
| `devOrigin` | `string` | The listening Vite server origin | Public origin used in development tags. It must be an absolute HTTPS origin with no credentials, path, query, or hash. Use it for a separately managed tunnel; the plugin configures Vite for that origin but does not start the tunnel. |
| `diagnostics` | `boolean` | `false` | Emits opt-in lifecycle diagnostics through Vite's `info` logger. Generated output and ownership behavior are unchanged. |

`entries` is authoritative. Entry keys do not need to match source filenames, but they are the exact values supplied as the snippet's `entry` argument. A stylesheet is recognized from its source extension, not its entry key.

With `diagnostics: true`, lifecycle messages use the stable prefix `[shopify-theme:diagnostic:<EVENT>]`. Events cover resolved configuration, ownership acquisition and release, production output and stale cleanup counts, development snippet activation and restoration, and theme-file hot reloads. They follow Vite's logger and `logLevel`; the option writes nothing directly to the console and is silent by default.

### Vite configuration owned by the plugin

The plugin intentionally controls the settings that make the generated Liquid and Shopify assets deterministic:

| Vite setting | Plugin value | Reason |
| --- | --- | --- |
| `root` | `themeRoot` | Keeps source URLs and generated paths relative to the Shopify theme. |
| `appType` | `custom` | Runs Vite without an HTML entrypoint. |
| `input` and `build.rolldownOptions.input` | The explicit entry map | Prevents Vite or another plugin from changing the manifest contract. Both paths are populated for Vite 8.0 compatibility. |
| `build.outDir` | `<themeRoot>/assets` | Writes build output directly into Shopify's asset directory. |
| `build.manifest` | `vite-manifest.json` | Gives the Liquid generator a stable manifest location. |
| `publicDir` | `false` | Prevents implicit copying of files into the theme assets. |
| `base` | `./` | Produces relative references suitable for Shopify-hosted assets. |
| `build.emptyOutDir` | `false` | Preserves manually authored and otherwise unowned theme assets. |

User values that conflict with these settings are rejected with the exact option name and the required value. In particular, do not configure `input`, `build.rolldownOptions.input`, `build.outDir`, or `build.manifest`; do not enable `publicDir` or `build.emptyOutDir`; and do not set a non-relative `base` or an `appType` other than `custom`. Other Vite options remain available, including `build.modulePreload` and `build.cssCodeSplit`.

## Common workflows

### Production build

Add a conventional script and build the theme:

```json
{
  "scripts": {
    "build": "vite build",
    "dev": "vite"
  }
}
```

```sh
npm run build
```

Vite writes flat, hashed JavaScript, CSS, and chunk files plus `assets/vite-manifest.json`. The plugin generates the configured production snippet and records generated bundle files in `.vite-shopify-theme.json`. On the next successful build it removes only obsolete flat asset files listed by that preceding state; manual assets are never inferred or broadly cleaned.

Production snippets follow Vite's `build.modulePreload` setting. Shared imported JavaScript is emitted as module preloads unless `build.modulePreload` is `false`, and styles discovered through the manifest are emitted before scripts.

The default preload traversal is the recommended policy. It is iterative, deterministic, cycle-safe, and does not consume the JavaScript call stack for deep manifest graphs. Set `build.modulePreload: false` when the storefront should load chunks only through their JavaScript imports. Because Shopify renders Liquid rather than a Vite HTML entrypoint, an entry may optionally import `vite/modulepreload-polyfill` first when older-browser support for dynamic module preloading is required. No plugin option is needed for either policy.

Vite gives emitted assets content-hashed filenames; Shopify's `asset_url` filter may then append its own `?v=` CDN version. These layers are complementary: the filename identifies the bundle content and Shopify controls its delivery cache. Do not append manual query strings to generated asset names or introduce a second versioning scheme.

## Development modes

### Local storefront preview

Run Vite and Shopify CLI in separate terminals so Shopify serves Liquid while Vite serves frontend modules and HMR:

```sh
npm run dev
```

```sh
shopify theme dev
```

When Vite begins listening, the plugin temporarily replaces the configured snippet with tags for `@vite/client`, its theme-reload client, and each explicit entry. Changes to Liquid and JSON files inside the theme trigger a storefront reload. On normal shutdown, the prior snippet is restored (or the temporary file is removed if none existed).

Build and development processes take exclusive ownership of a theme root. Run only one Vite build or server against a given theme at a time.

This mode uses Vite's local HTTP origin and is the shortest feedback loop. Open the storefront URL printed by `shopify theme dev`; do not use this mode for the hosted Theme Editor iframe.

### Hosted Theme Editor

Shopify serves the Theme Editor over HTTPS. Browsers can block the local HTTP modules and WebSocket used by Vite when they are loaded inside that HTTPS iframe. A working local storefront preview therefore does not imply that the Theme Editor can reach Vite.

To develop inside the Theme Editor, expose Vite through a separately managed HTTPS tunnel, set its public origin as `devOrigin`, and restart Vite whenever that origin changes. For production-like verification without HMR, run `npm run build` and preview the generated Shopify assets instead.

### External HTTPS tunnel

The tunnel must provide a publicly reachable HTTPS origin with a valid certificate and forward both HTTP requests and WebSocket upgrades to Vite. Prefer a stable origin because the generated snippet, allowed host, CORS policy, and HMR client are resolved when Vite starts.

Start the external tunnel before Vite. With Cloudflare Tunnel:

```sh
cloudflared tunnel --url http://127.0.0.1:5173
```

```sh
SHOPIFY_VITE_ORIGIN=https://example.trycloudflare.com npm run dev
```

Pass the variable into the plugin explicitly:

```ts
shopifyTheme({
  entries: {
    'theme.css': 'frontend/entrypoints/theme.css',
    'theme.ts': 'frontend/entrypoints/theme.ts',
  },
  devOrigin: process.env.SHOPIFY_VITE_ORIGIN,
})
```

With ngrok, use the same order:

```sh
ngrok http 5173
SHOPIFY_VITE_ORIGIN=https://example.ngrok-free.app npm run dev
```

Cloudflare Tunnel and ngrok are examples, not integrations or dependencies. The plugin configures Vite for the supplied origin but does not discover URLs, start processes, manage credentials, or keep tunnels alive.

## Framework recipes

### Vue and React sections

Framework plugins compose normally with `shopifyTheme()`. Keep framework compilation and Fast Refresh in the official framework plugin; this plugin continues to own only explicit entries, Shopify asset output, and the generated Liquid tags.

For Vue, register the Vue plugin and mount a separate application on every element emitted by a section:

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [
    vue(),
    shopifyTheme({ entries: { 'sections.js': 'frontend/sections.js' } }),
  ],
});
```

```ts
import { createApp } from 'vue';
import ProductSection from './ProductSection.vue';

for (const element of document.querySelectorAll<HTMLElement>('[data-vue-product]')) {
  createApp(ProductSection, { productId: element.dataset.productId }).mount(element);
}
```

For React, import the preamble before React or application code. Vite cannot inject it into Shopify-rendered HTML, so this explicit import is required for Fast Refresh:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [
    react(),
    shopifyTheme({ entries: { 'sections.jsx': 'frontend/sections.jsx' } }),
  ],
});
```

```tsx
import '@vitejs/plugin-react/preamble';
import { createRoot } from 'react-dom/client';
import ProductSection from './ProductSection';

for (const element of document.querySelectorAll<HTMLElement>('[data-react-product]')) {
  createRoot(element).render(<ProductSection productId={element.dataset.productId} />);
}
```

Liquid remains responsible for rendering stable mount elements and their initial data. Mount each element independently because a section can appear multiple times and Shopify can replace section markup in the Theme Editor. Vite and the framework plugin handle module HMR or Fast Refresh; this plugin separately reloads the storefront for Liquid and JSON changes. Application code that must survive Theme Editor section insertion should also listen for Shopify's section lifecycle events and mount only unmounted elements.

## Advanced workflows

### CSS and preprocessors

Stylesheet entries may use Vite's supported `.css`, `.pcss`, `.postcss`, `.scss`, `.sass`, `.less`, `.styl`, and `.stylus` extensions, including CSS Module variants. Vite handles `.pcss` and `.postcss` through its PostCSS pipeline; advanced PostCSS syntax requires the corresponding Vite/PostCSS configuration and plugins. Install the corresponding Sass, Less, or Stylus preprocessor when using one.

CSS entry names are ordinary Liquid-facing names when code splitting is enabled:

```ts
shopifyTheme({
  entries: {
    'theme.css': 'frontend/entrypoints/theme.scss',
    'theme.ts': 'frontend/entrypoints/theme.ts',
  },
})
```

### Disabling CSS code splitting

With `build.cssCodeSplit: false`, all CSS, including explicit stylesheet entries, is emitted as one shared asset. The plugin automatically includes that asset once in every entry branch, so remove separate stylesheet renders such as `{% render 'vite-tag', entry: 'theme.css' %}` from the layout. The entry name `style.css` is reserved for the plugin's virtual aggregate in this mode and cannot name a non-stylesheet source.

### Custom snippets and non-standard theme directories

Point `themeRoot` at the Shopify theme and keep all entry sources and the generated snippet inside it:

```ts
shopifyTheme({
  themeRoot: 'shopify/theme',
  snippet: 'snippets/frontend-assets.liquid',
  entries: {
    storefront: 'frontend/storefront.ts',
  },
})
```

Then render the custom snippet name:

```liquid
{% render 'frontend-assets' %}
{% render 'frontend-assets', entry: 'storefront' %}
```

Paths are resolved from Vite's configured root when one is supplied, otherwise from the process working directory. Avoid also setting Vite `root` when a direct `themeRoot` path is clearer.

The theme root itself may be a symlink. Entry files and writable locations may also cross symlinks only when their real targets remain inside the canonical theme root. Escaping entry, snippet, asset, ownership-state, lock, manifest, and recovery paths are rejected before the plugin reads, writes, or deletes them. A stale development lock restores a snippet only when its recorded path remains contained and its generated hash still matches; otherwise the snippet is preserved.

### Theme App Extensions

A [Theme App Extension](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration) has its own `assets`, `blocks`, `snippets`, and `locales` directories. The plugin can build against that extension directory when its entry sources also live inside the same root:

```ts
shopifyTheme({
  themeRoot: 'extensions/product-widget',
  entries: {
    'widget.css': 'assets/widget.source.css',
    'widget.js': 'assets/widget.source.js',
  },
})
```

Render the generated snippet from an app block or app embed block:

```liquid
{% render 'vite-tag', entry: 'widget.css' %}
<div data-product-widget></div>
{% render 'vite-tag', entry: 'widget.js' %}
```

Do not also declare those bundles through the block schema's `javascript` or `stylesheet` attributes: those attributes expect fixed asset filenames, while the generated snippet resolves Vite's hashed filenames through `asset_url`. Source files placed in `assets` remain extension assets, so use browser-ready JavaScript and CSS for this direct layout. Projects that keep TypeScript or framework sources outside the deployable extension need a separate staging/copy step owned by the app repository; this plugin deliberately does not copy arbitrary source trees or deploy extensions.

Run `vite build` before `shopify app build` or `shopify app deploy`, commit or package the generated extension assets according to the app's release policy, and let Shopify CLI validate the result. Shopify currently enforces a 10 MB total extension limit and documents suggested compressed limits of 100 KB for directly referenced CSS and 10 KB for directly referenced JavaScript. Development still follows the modes above: Shopify CLI owns the app-extension preview, while Vite and any HTTPS tunnel remain separate processes.

## Why Vite-only

This package is a Vite plugin rather than a framework-neutral asset builder. Its contract depends directly on Vite plugin hooks: `config` and `configResolved` establish the theme root and deterministic build settings; `resolveId` and `load` provide the virtual reload and aggregate-CSS modules; `buildStart`, `generateBundle`, `writeBundle`, and `closeBundle` coordinate build ownership and generate Liquid from Vite's output; and `configureServer`, `handleHotUpdate`, and `closeServer` manage the development snippet and storefront reloads.

Those hooks also let the plugin follow Vite's manifest, module-preload, CSS-splitting, server, and HMR behavior without duplicating Vite internally. Other bundlers do not expose the same lifecycle contract, so they are intentionally outside this package's scope.

## Migrating from 0.1.0

Version 0.2.0 replaces the contract published in 0.1.0. Update configuration and development scripts together rather than treating it as a drop-in upgrade.

1. Remove calls to the `shopify-theme` executable and remove its legacy CLI options. Use ordinary `vite` scripts and run Shopify CLI separately:

   ```json
   {
     "scripts": {
       "build": "vite build",
       "dev": "vite"
     }
   }
   ```

   Start `npm run dev` and `shopify theme dev` in separate terminals.

2. Replace the singular `entry` option with an explicit `entries` map. Each key becomes the Liquid-facing name and each value is a source file relative to the theme root:

   ```ts
   shopifyTheme({
     entries: {
       'theme.css': 'frontend/entrypoints/theme.css',
       'theme.ts': 'frontend/entrypoints/theme.ts',
     },
     themeRoot: '.',
   })
   ```

3. Treat `themeRoot` as the plugin boundary. Entry sources, `assets`, the generated snippet, ownership state, and the process lock all live inside it. If `vite.config.ts` is outside the Shopify theme, set `themeRoot` to that theme directory instead of relying on the old working-directory behavior.

4. Render the generated snippet once without an entry to install the development clients, then render each named entry where it belongs:

   ```liquid
   {% render 'vite-tag' %}
   {% render 'vite-tag', entry: 'theme.css' %}
   {% render 'vite-tag', entry: 'theme.ts' %}
   ```

`shopifyTheme()` now returns a single Vite plugin. The package is ESM-only, has no runtime dependencies, and supports imports only from `@display-studio/vite-plugin-shopify-theme`; remove CommonJS loading and imports from package internals.

## Troubleshooting

Plugin errors and warnings begin with `[shopify-theme:<CODE>]`. The code is stable and searchable; the remaining text supplies the affected option, entry, or filesystem path. Status messages continue to use `[shopify-theme]` without a code.

| Codes | Meaning |
| --- | --- |
| `CONFIG_ENTRIES`, `CONFIG_THEME_ROOT`, `CONFIG_SNIPPET`, `CONFIG_DEV_ORIGIN`, `CONFIG_DIAGNOSTICS` | Invalid plugin options or unsafe configured paths |
| `CONFIG_VITE_CONFLICT`, `CONFIG_CSS_ENTRY_RESERVED` | User Vite configuration conflicts with plugin-owned settings |
| `PATH_OUTSIDE_THEME`, `PATH_RESOLUTION_FAILED`, `PATH_MISSING` | A generated, recorded, or changed path is unsafe or unavailable |
| `FS_READ_FAILED`, `FS_JSON_INVALID`, `FS_REMOVE_FAILED`, `FS_WRITE_FAILED` | A required filesystem operation failed |
| `STATE_INVALID` | Generated-asset ownership state has an unsafe structure |
| `MANIFEST_INVALID`, `MANIFEST_ENTRY_MISSING`, `MANIFEST_IMPORT_MISSING` | Vite manifest data is invalid or incomplete |
| `LOCK_CREATE_FAILED`, `LOCK_ACTIVE`, `LOCK_METADATA_MISSING`, `LOCK_METADATA_INVALID` | Theme ownership cannot be safely established |
| `LOCK_RECLAIM_FAILED`, `LOCK_ACQUIRE_FAILED`, `LOCK_CHANGED`, `LOCK_RELEASE_FAILED` | Theme ownership recovery or cleanup failed |
| `BUILD_CSS_MISSING`, `BUILD_CLEANUP_FAILED`, `BUILD_ROLLBACK_FAILED` | Post-build generation or its safety rollback failed |
| `DEV_ORIGIN_UNAVAILABLE`, `DEV_OWNERSHIP_LOST`, `DEV_EXTERNAL_ORIGIN` | Development server startup or external-origin guidance |

| Problem | Likely cause | Remedy |
| --- | --- | --- |
| An entry is missing, is a directory, duplicates another source, or resolves outside the theme | `entries` contains an invalid or unsafe source path | Correct the reported mapping. Every source must be a distinct, readable file inside `themeRoot`. |
| Startup reports a Vite option conflict | User config or another pre-plugin value overrides a plugin-owned setting | Remove the reported setting and let the plugin supply its required value. Check input, output, manifest, public directory, base, app type, and empty-output settings. |
| A build or dev server reports an active ownership lock | Another live process already owns the same theme root | Stop that Vite build or server, then retry. Do not run concurrent plugin processes against one theme. |
| A stale development lock is found after a crash | The recorded process no longer exists | Restart Vite. The plugin reclaims valid stale metadata and restores the old snippet only when the current temporary snippet still matches its recorded hash. |
| Lock metadata is missing, corrupt, invalid, or cannot be verified | `.vite-shopify-theme.lock/owner.json` was damaged or edited | First confirm that no Vite process owns the theme. Only then remove the reported lock directory and retry. Uncertain locks deliberately fail closed. |
| Ownership state is invalid | `.vite-shopify-theme.json` does not contain `{ "files": ["flat-name"] }` | Repair or remove the state file and retry. No recorded assets are deleted when validation fails. Removing it forfeits cleanup knowledge for the preceding build but does not delete assets. |
| A generated file, lock, or stale asset cannot be written or removed | Theme directories or files are not writable by the current user | Correct filesystem ownership/permissions for the reported path, then retry. The plugin uses atomic writes and preserves the primary failure diagnostic. |
| A temporary development snippet was edited manually | Its hash no longer matches the lock's generated hash | Stop Vite and preserve or reconcile the edited snippet manually. The plugin intentionally will not overwrite or restore over the edit. Restart development after the desired production snippet is in place. |
| The manifest is missing, invalid, lacks an entry/import, or the aggregate CSS asset is absent | Build input/output was changed, the build was interrupted, or generated files are inconsistent | Stop competing processes, restore plugin-owned Vite settings, and run a clean build. Inspect the specifically reported manifest entry before deleting files. |
| CSS or JavaScript is absent from the Shopify preview | The matching snippet render is missing, the entry key is wrong, or the browser cannot reach Vite | Verify the layout renders the runtime once and uses exact `entries` keys. In development, request `@vite/client` and the entry URL directly from the browser. |
| Local preview works but Theme Editor assets or HMR do not | Shopify's HTTPS iframe cannot use the local HTTP origin, or the tunnel does not forward WebSockets | Use a stable HTTPS `devOrigin`, verify its certificate and CORS access, ensure HTTP and WebSocket forwarding work, and restart Vite after URL changes. |

During development all generated script and stylesheet tags use anonymous CORS. Once the development snippet is active, the plugin writes one readiness message through Vite's logger; Vite's `logLevel` and custom logger still apply.

## Public API

The package has one supported entrypoint: `@display-studio/vite-plugin-shopify-theme`. It exports `shopifyTheme` both as the default export and as a named export, plus the named utilities `normalizeOptions`, `collectManifestTags`, `developmentSnippet`, and `productionSnippet`. Its public TypeScript types are `ShopifyThemeOptions`, `NormalizedOptions`, and `ManifestTags`.

Files below `dist/*`, internal modules, and undeclared package subpaths are implementation details, not supported API. Import all public values and types from `@display-studio/vite-plugin-shopify-theme`.

## HMR troubleshooting

Run Vite and [`shopify theme dev`](https://shopify.dev/docs/api/shopify-cli/theme/theme-dev) together so Shopify serves the theme while Vite serves its frontend modules. Without `SHOPIFY_VITE_ORIGIN`, the generated snippet uses Vite's local origin. Set that variable to a stable HTTPS origin only when the storefront must reach Vite through a separately managed tunnel; the tunnel must forward both HTTP and WebSocket traffic. The plugin applies the corresponding Vite [`server.ws`](https://vite.dev/config/server-options.html#server-ws) configuration, but does not create or keep the tunnel alive.

The local storefront preview can load Vite directly from `http://127.0.0.1:5173`. Shopify's HTTPS Theme Editor cannot reliably load that HTTP origin inside its preview iframe, so CSS, JavaScript, and HMR may appear to be missing there even though the local preview works. To use the Theme Editor, start a separate HTTPS tunnel that forwards to Vite, copy its public origin, and pass it when starting development. For example, with a Cloudflare quick tunnel:

```sh
cloudflared tunnel --url http://127.0.0.1:5173
```

Keep that process running, then use the HTTPS URL it prints:

```sh
SHOPIFY_VITE_ORIGIN=https://example.trycloudflare.com npm run playground:dev
```

Start the tunnel before the playground so the generated snippet and Vite WebSocket configuration receive the correct origin. Quick-tunnel URLs usually change when restarted; update `SHOPIFY_VITE_ORIGIN` and restart the playground whenever that happens. A tunnel is unnecessary when testing only through the local storefront preview.

If HMR does not connect, verify in the browser that `@vite/client` and the requested entry load from the expected origin, that CORS permits the tunnel origin, that its HTTPS certificate is trusted, and that the WebSocket connection succeeds. Restart Vite whenever the tunnel URL changes so the snippet and WebSocket configuration use the new origin.

The vendored [official Skeleton Theme playground](playground/skeleton-theme) includes a dependency-free Node orchestrator for Vite and `shopify theme dev`. See its [provenance and deliberate refresh procedure](playground/skeleton-theme/UPSTREAM.md).

### Shopify development end-to-end test

The real Shopify development smoke test is opt-in because it uploads the playground as a development theme and requires access to a Shopify store. It is intentionally excluded from `npm run check` and CI. Install the repository dependencies, provide the [Shopify CLI `theme dev` environment variables](https://shopify.dev/docs/api/shopify-cli/theme/theme-dev), and run:

```sh
SHOPIFY_FLAG_STORE=example.myshopify.com \
SHOPIFY_CLI_THEME_TOKEN=shptka_... \
npm run e2e:shopify
```

`SHOPIFY_FLAG_PASSWORD` is also honored when the storefront is password protected. The harness never places credentials in process arguments or files. It builds the package, starts Vite and `shopify theme dev` against the Skeleton Theme playground, requests the local Shopify preview, verifies the development tags for `theme.css` and `theme.ts`, and then loads both entrypoints from Vite. It does not enable `--theme-editor-sync`, so remote Theme Editor changes are not synchronized into the tracked fixture. Maintainers can run the same test through the manual, `main`-only `Shopify E2E` workflow and its approval-protected `shopify-e2e` environment.

Vite uses port `5173` and the Shopify preview uses port `9292`. Override them with `SHOPIFY_VITE_PORT` and `SHOPIFY_THEME_PORT`; use `SHOPIFY_E2E_TIMEOUT_MS` to change the 120-second startup timeout. Occupied ports fail before either server starts. The harness stops both processes on success, failure, `SIGINT`, or `SIGTERM` and verifies that the plugin restored the original generated snippet.

## Commands

```sh
npm ci
npm ci --prefix playground/skeleton-theme
npm run check
```

The root package and vendored playground intentionally remain separate npm projects with separate lockfiles. Install both before running the canonical check. Individual checks remain available as `typecheck`, `test`, `build`, `playground:build`, `pack:check`, and `theme:check`. The credentialed `e2e:shopify` smoke test is documented above and remains opt-in.

Compatibility checks install a freshly packed copy of the plugin and their requested tools in an isolated temporary directory, so they require network access and intentionally remain outside `npm run check`:

```sh
VITE_VERSION=8.0.0 npm run compat:vite
SHOPIFY_CLI_VERSION=3.94.3 npm run compat:shopify
VITE_VERSION=8 SHOPIFY_CLI_VERSION=4 npm run compat
npm run compat:frameworks
npm run compat:consumer -- npm
npm run compat:consumer -- pnpm
npm run compat:consumer -- yarn
npm run compat:consumer -- bun
```

Without an environment override, the Vite check uses `8` and the Shopify Theme Check uses `4`. The framework command checks Vue and React together; `compat:vue` and `compat:react` run their fixtures separately. All compatibility commands require network access and remain outside `npm run check`.

## Support matrix

| Component | Supported contract | CI coverage |
| --- | --- | --- |
| Node.js | `^20.19.0 || >=22.12.0` | 20.19.0, 22, 24, and 26 |
| Vite | `^8.0.0` peer dependency | Minimum 8.0.0 and latest 8.x on every tested Node version |
| Shopify CLI | Not a dependency | Theme Check with 3.94.3 and latest 4.x on Node 24 |
| Vue | Optional composition | Vue 3 with `@vitejs/plugin-vue` 6 and Vite 8 on Node 24 |
| React | Optional composition | React 19 with `@vitejs/plugin-react` 6 and Vite 8 on Node 24 |
| Operating systems | Linux, macOS, and Windows | Canonical `npm run check` on Node 24 |
| npm packaging | npm bundled with minimum Node (`10.8.2`) and current npm | Fresh package build, pack, install, metadata, exports, and files |
| Consumer managers | npm, pnpm, Yarn, and Bun | Fresh tarball install, public import, Vite build, assets, snippet, and manual-file preservation |
| Filesystem links | Symlinked roots and contained targets | Canonical-path acceptance plus escaping read/write-path rejection |
| Shopify development | Credentialed opt-in smoke test | Approval-protected manual workflow on `main` with exact snippet restoration |
| Release | npm Trusted Publishing and GitHub Release | Tag/version verification, full compatibility suite, integrity-safe reruns, and protected environment |

Node 21 and Node releases before 20.19.0 or in the 22.x line before 22.12.0 are excluded because Vite 8 does not support them. Node 20 remains supported despite its EOL and will be retained until a future incompatible major release. Shopify CLI is used only for compatibility verification; consumers do not receive it as a dependency.

## Roadmap

The completed `0.2.x` roadmap and upcoming work are tracked in [Roadmap: adoption, developer experience, and path to 1.0](https://github.com/display-design-studio/vite-plugin-shopify-theme/issues/1). The tracking issue is the canonical checklist and links to focused implementation issues as work begins.

The project invariants take precedence over every roadmap item: entries remain explicit, the package keeps zero runtime dependencies, generated output stays deterministic, cleanup never broadens beyond plugin-owned assets, and managed tunnels, Shopify deployment, and an internal CLI remain outside the core package.

## Release process

Releases are tag-driven. A `v*` tag must match `package.json`; the workflow runs the canonical and network-dependent compatibility suites, then waits on the protected `release` environment. npm publication uses Trusted Publishing from `.github/workflows/release.yml` with no repository npm token. On a rerun, an existing registry version is accepted only when its integrity exactly matches the locally packed artifact, after which the workflow creates or reconciles the GitHub Release.

<!-- Badges -->

[npm-version-src]: https://npmx.dev/api/registry/badge/version/@display-studio/vite-plugin-shopify-theme
[npm-version-href]: https://npmx.dev/package/@display-studio/vite-plugin-shopify-theme
[npm-downloads-src]: https://npmx.dev/api/registry/badge/downloads/@display-studio/vite-plugin-shopify-theme
[npm-downloads-href]: https://npmx.dev/package/@display-studio/vite-plugin-shopify-theme
[build-src]: https://img.shields.io/github/actions/workflow/status/display-design-studio/vite-plugin-shopify-theme/ci.yml?branch=main&style=flat-square&label=build
[build-href]: https://github.com/display-design-studio/vite-plugin-shopify-theme/actions/workflows/ci.yml
