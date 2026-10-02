# @display-studio/vite-plugin-shopify-theme

A zero-runtime-dependency Vite 8 plugin that builds explicit frontend entries into a Shopify theme's `assets` directory and generates a Liquid snippet for production and development.

## Requirements and installation

- Node.js `^20.19.0 || >=22.12.0`.
- Vite `^8.0.0` in the consuming project.
- A Shopify theme directory containing the usual `assets`, `layout`, and `snippets` directories. Shopify CLI is useful for local theme previews, but is not a plugin dependency.

Install Vite and the plugin as development dependencies:

```sh
npm install --save-dev vite @display-studio/vite-plugin-shopify-theme
```

Create `vite.config.ts` in the theme root. Every frontend entry is explicit: the key is the name passed from Liquid and the value is its source path relative to the theme root.

```ts
import { defineConfig } from 'vite';
import { shopifyTheme } from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [shopifyTheme({
    entries: {
      'theme.css': 'frontend/entrypoints/theme.css',
      'theme.ts': 'frontend/entrypoints/theme.ts',
    },
    themeRoot: '.',
    snippet: 'snippets/vite-tag.liquid',
    devOrigin: process.env.SHOPIFY_VITE_ORIGIN,
  })],
});
```

Render the snippet without an entry once in `<head>` to install the Vite client during development. Render CSS entries in `<head>` and JavaScript entries where the theme should load them:

```liquid
{% render 'vite-tag' %}
{% render 'vite-tag', entry: 'theme.css' %}
{% render 'vite-tag', entry: 'theme.ts' %}
```

The entryless render emits nothing in production, so it is safe to leave it in the layout.

## Configuration

| Option | Type | Default | Contract and behavior |
| --- | --- | --- | --- |
| `entries` | `Record<string, string>` | Required | A non-empty map of Liquid entry names to source files. Names must match `[A-Za-z0-9][A-Za-z0-9._-]*`; sources must be distinct existing files inside `themeRoot`. This map is authoritative and is not supplemented by entry discovery. |
| `themeRoot` | `string` | `.` | Theme directory, resolved from Vite's configured `root` when present, otherwise from the current working directory. Entries, the snippet, `assets`, ownership state, and the process lock are scoped to this directory. |
| `snippet` | `string` | `snippets/vite-tag.liquid` | Generated Liquid file, resolved relative to and required to remain inside `themeRoot`. Render the corresponding snippet name from Liquid. The file is generated on build and temporarily replaced during development. |
| `devOrigin` | `string` | The listening Vite server origin | Public origin used in development tags. It must be an absolute HTTPS origin with no credentials, path, query, or hash. Use it for a separately managed tunnel; the plugin configures Vite for that origin but does not start the tunnel. |

`entries` is authoritative. Entry keys do not need to match source filenames, but they are the exact values supplied as the snippet's `entry` argument. A stylesheet is recognized from its source extension, not its entry key.

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

The default recursive preload traversal is the recommended policy. Set `build.modulePreload: false` when the storefront should load chunks only through their JavaScript imports. Because Shopify renders Liquid rather than a Vite HTML entrypoint, an entry may optionally import `vite/modulepreload-polyfill` first when older-browser support for dynamic module preloading is required. No plugin option is needed for either policy.

Vite gives emitted assets content-hashed filenames; Shopify's `asset_url` filter may then append its own `?v=` CDN version. These layers are complementary: the filename identifies the bundle content and Shopify controls its delivery cache. Do not append manual query strings to generated asset names or introduce a second versioning scheme.

### Local development with Shopify CLI

Run Vite and Shopify CLI in separate terminals so Shopify serves Liquid while Vite serves frontend modules and HMR:

```sh
npm run dev
```

```sh
shopify theme dev
```

When Vite begins listening, the plugin temporarily replaces the configured snippet with tags for `@vite/client`, its theme-reload client, and each explicit entry. Changes to Liquid and JSON files inside the theme trigger a storefront reload. On normal shutdown, the prior snippet is restored (or the temporary file is removed if none existed).

Build and development processes take exclusive ownership of a theme root. Run only one Vite build or server against a given theme at a time.

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

### Theme Editor through an HTTPS tunnel

The local storefront preview can load Vite directly over HTTP, but Shopify's HTTPS Theme Editor requires a publicly reachable HTTPS origin with a valid certificate. The tunnel must forward both HTTP requests and WebSocket upgrades to Vite. Prefer a stable origin; if it changes, restart Vite so the generated snippet, allowed host, CORS policy, and HMR client all receive the new value.

With Cloudflare Tunnel, start the external tunnel process first:

```sh
cloudflared tunnel --url http://127.0.0.1:5173
```

```sh
SHOPIFY_VITE_ORIGIN=https://example.trycloudflare.com npm run dev
```

Pass that variable to `devOrigin` as shown in the initial configuration. The plugin sets Vite's CORS origin, allowed host, and secure WebSocket client endpoint. It does not create, monitor, or restart the tunnel. Restart Vite whenever the public URL changes.

With ngrok, the equivalent flow is:

```sh
ngrok http 5173
```

```sh
SHOPIFY_VITE_ORIGIN=https://example.ngrok-free.app npm run dev
```

Cloudflare Tunnel and ngrok are examples, not integrations or dependencies. Supply any provider's public origin through `devOrigin`; process startup, accounts, credentials, SDKs, URL discovery, and tunnel lifecycle stay outside the plugin.

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

Plugin diagnostics begin with `[shopify-theme]` and identify the relevant option or filesystem path.

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

`SHOPIFY_FLAG_STORE_PASSWORD` is also honored when the storefront is password protected. The harness never places credentials in process arguments or files. It builds the package, starts Vite and `shopify theme dev` against the Skeleton Theme playground, requests the local Shopify preview, verifies the development tags for `theme.css` and `theme.ts`, and then loads both entrypoints from Vite. It does not enable `--theme-editor-sync`, so remote Theme Editor changes are not synchronized into the tracked fixture.

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

Node 21 and Node releases before 20.19.0 or in the 22.x line before 22.12.0 are excluded because Vite 8 does not support them. Node 20 remains supported despite its EOL and will be retained until a future incompatible major release. Shopify CLI is used only for compatibility verification; consumers do not receive it as a dependency.

## Roadmap

The project invariants take precedence over every roadmap item: entries remain explicit, the package keeps zero runtime dependencies, generated output stays deterministic, cleanup never broadens beyond plugin-owned assets, and the public API does not receive breaking changes.

### P0 — Correctness

- [x] Use isolated temporary fixtures for integration tests.
- [x] Protect generated state from concurrent build and development processes.
- [x] Write generated files atomically.
- [x] Cover startup, rebuild, shutdown, interruption, and recovery lifecycles.
- [x] Align with Vite 8 top-level `input`, `server.ws`, and backend tag ordering.
- [x] Set `publicDir: false` for plugin-controlled builds.
- [x] Provide canonical check scripts for the complete validation sequence.

### P1 — Developer experience

- [x] Support the expected stylesheet extensions across entry handling and generated tags.
- [x] Apply CORS attributes consistently to generated development tags.
- [x] Turn configuration and filesystem failures into actionable diagnostics.
- [x] Keep startup logging concise and useful.
- [x] Warn clearly about tunnel ownership, stability, and HTTPS requirements.
- [x] Document HMR troubleshooting for local and tunneled development.
- [x] Add repository agent instructions for contributors and automation.

### P2 — Maintainability

- [x] Separate internal responsibilities for configuration, asset ownership, snippet rendering, and lifecycle state.
- [x] Expand compatibility fixtures across supported Node, Vite, and Shopify CLI versions.
- [x] Strengthen package-content and install validation.
- [x] Document the supported package exports.
- [x] Publish and maintain a support matrix.

### P3 — Core compatibility and release readiness

- [x] Honor Vite build options that affect generated module preloads and CSS code splitting.
- [x] Support explicit `.pcss` and `.postcss` stylesheet entries.
- [x] Add an end-to-end fixture against a real Shopify development workflow.
- [x] Expand developer-experience documentation for configuration, troubleshooting, and common workflows.
- [x] Complete release-readiness checks, documentation, and packaging validation.

### P4 — Optional integrations

- [x] Verify Vue and React plugin composition, including an explicit React preamble for Fast Refresh, without making either framework part of the core package contract.
- [x] Retain Vite's recursive module preloads (or `build.modulePreload: false`), optional entry polyfill, content hashes, and Shopify CDN versioning without adding another API or versioning layer.
- [x] Document provider-agnostic external tunnels, including Cloudflare Tunnel and ngrok, while keeping processes, SDKs, credentials, and dependencies outside the plugin.

### Barrel reference

Adopt the reference project's useful discipline around explicit entry configuration, deterministic manifests, focused lifecycle handling, actionable diagnostics, and realistic integration fixtures. Automatic entry discovery and core tunnel management remain intentionally excluded: explicit entrypoints and zero runtime dependencies are product constraints, not temporary omissions. Framework-specific helpers, tunnel adapters, and broader asset orchestration may be evaluated only as optional integrations that do not weaken the invariants above.
