# vite-plugin-shopify-theme

A zero-runtime-dependency Vite 8 plugin that builds explicit frontend entries into a Shopify theme's `assets` directory and generates a Liquid snippet for production and development.

```ts
import { defineConfig } from 'vite';
import { shopifyTheme } from 'vite-plugin-shopify-theme';

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

Render the runtime once in `<head>`, render CSS entries in `<head>`, and scripts where appropriate:

```liquid
{% render 'vite-tag' %}
{% render 'vite-tag', entry: 'theme.css' %}
{% render 'vite-tag', entry: 'theme.ts' %}
```

`entries` is authoritative. Every source must exist within `themeRoot`, and both names and sources must be unique. The plugin owns Vite's input (including the Vite 8.0 build-input compatibility path), disables `publicDir`, uses a relative base, emits flat Shopify-compatible assets, retains manually-authored assets, and deletes only obsolete files recorded by the plugin's preceding successful build.

Stylesheet entries may use Vite's supported `.css`, `.scss`, `.sass`, `.less`, `.styl`, and `.stylus` extensions, including CSS Module variants. Install the corresponding Sass, Less, or Stylus preprocessor when using one.

Production snippets follow Vite's `build.modulePreload` and `build.cssCodeSplit` settings. With `cssCodeSplit: false`, all CSS—including explicit stylesheet entries—is emitted as one shared asset and automatically included once in every entry branch; do not render a separate `style.css` entry.

During `vite` development the snippet points at the resolved local server and marks all development scripts and styles for anonymous CORS. Once the development snippet is active, the plugin writes one concise readiness message through Vite's logger; Vite's `logLevel` and custom logger settings continue to apply. Set `SHOPIFY_VITE_ORIGIN=https://stable-tunnel.example` when a separately managed HTTPS tunnel is needed; the plugin configures `server.ws`, CORS, and the allowed host but never starts a tunnel. Build and development processes take exclusive ownership of a theme root. Interrupted development is recovered only when the generated snippet still has the recorded hash, so a manual edit is never overwritten.

Configuration and filesystem failures identify the option or path involved and suggest a recovery action. Invalid ownership state or lock metadata fails safely instead of deleting assets or reclaiming uncertain ownership; inspect the reported file and confirm that no Vite process owns the theme before removing a lock manually.

## Public API

The package has one supported entrypoint: `vite-plugin-shopify-theme`. It exports `shopifyTheme` both as the default export and as a named export, plus the named utilities `normalizeOptions`, `collectManifestTags`, `developmentSnippet`, and `productionSnippet`. Its public TypeScript types are `ShopifyThemeOptions`, `NormalizedOptions`, and `ManifestTags`.

Files below `dist/*`, internal modules, and undeclared package subpaths are implementation details, not supported API. Import all public values and types from `vite-plugin-shopify-theme`.

## HMR troubleshooting

Run Vite and [`shopify theme dev`](https://shopify.dev/docs/api/shopify-cli/theme/theme-dev) together so Shopify serves the theme while Vite serves its frontend modules. Without `SHOPIFY_VITE_ORIGIN`, the generated snippet uses Vite's local origin. Set that variable to a stable HTTPS origin only when the storefront must reach Vite through a separately managed tunnel; the tunnel must forward both HTTP and WebSocket traffic. The plugin applies the corresponding Vite [`server.ws`](https://vite.dev/config/server-options.html#server-ws) configuration, but does not create or keep the tunnel alive.

The local storefront preview can load Vite directly from `http://127.0.0.1:5173`. Shopify's HTTPS Theme Editor cannot reliably load that HTTP origin inside its preview iframe, so CSS, JavaScript, and HMR may appear to be missing there even though the local preview works. To use the Theme Editor, start a separate HTTPS tunnel that forwards to Vite, copy its public origin, and pass it when starting development. For example, with a Cloudflare quick tunnel:

```sh
cloudflared tunnel --url http://127.0.0.1:5173
```

Keep that process running, then use the HTTPS URL it prints:

```sh
SHOPIFY_VITE_ORIGIN=https://example.trycloudflare.com bun run playground:dev
```

Start the tunnel before the playground so the generated snippet and Vite WebSocket configuration receive the correct origin. Quick-tunnel URLs usually change when restarted; update `SHOPIFY_VITE_ORIGIN` and restart the playground whenever that happens. A tunnel is unnecessary when testing only through the local storefront preview.

If HMR does not connect, verify in the browser that `@vite/client` and the requested entry load from the expected origin, that CORS permits the tunnel origin, that its HTTPS certificate is trusted, and that the WebSocket connection succeeds. Restart Vite whenever the tunnel URL changes so the snippet and WebSocket configuration use the new origin.

The vendored [official Skeleton Theme playground](playground/skeleton-theme) includes a dependency-free Node orchestrator for Vite and `shopify theme dev`. See its [provenance and deliberate refresh procedure](playground/skeleton-theme/UPSTREAM.md).

## Commands

```sh
npm run check
```

Individual checks remain available as `typecheck`, `test`, `build`, `playground:build`, `pack:check`, and `theme:check`.

Compatibility checks install a freshly packed copy of the plugin and their requested tools in an isolated temporary directory, so they require network access and intentionally remain outside `npm run check`:

```sh
VITE_VERSION=8.0.0 npm run compat:vite
SHOPIFY_CLI_VERSION=3.94.3 npm run compat:shopify
VITE_VERSION=8 SHOPIFY_CLI_VERSION=4 npm run compat
```

Without an environment override, the Vite check uses `8` and the Shopify Theme Check uses `4`.

## Support matrix

| Component | Supported contract | CI coverage |
| --- | --- | --- |
| Node.js | `>=20.19.0` | 20.19.0, 22, 24, and 26 |
| Vite | `^8.0.0` peer dependency | Minimum 8.0.0 and latest 8.x on every tested Node version |
| Shopify CLI | Not a dependency | Theme Check with 3.94.3 and latest 4.x on Node 24 |

Node 20 remains supported despite its EOL and will be retained until a future incompatible major release. Shopify CLI is used only for compatibility verification; consumers do not receive it as a dependency.

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
- [ ] Support explicit `.pcss` and `.postcss` stylesheet entries.
- [ ] Add an end-to-end fixture against a real Shopify development workflow.
- [ ] Expand developer-experience documentation for configuration, troubleshooting, and common workflows.
- [ ] Complete release-readiness checks, documentation, and packaging validation.

### P4 — Optional integrations

- [ ] Evaluate React Refresh support without making React part of the core package contract.
- [ ] Evaluate advanced preload policies and asset versioning behind explicit configuration.
- [ ] Evaluate separately distributed tunnel adapters without adding tunnel ownership or dependencies to the core plugin.

### Barrel reference

Adopt the reference project's useful discipline around explicit entry configuration, deterministic manifests, focused lifecycle handling, actionable diagnostics, and realistic integration fixtures. Automatic entry discovery and core tunnel management remain intentionally excluded: explicit entrypoints and zero runtime dependencies are product constraints, not temporary omissions. Framework-specific helpers, tunnel adapters, and broader asset orchestration may be evaluated only as optional integrations that do not weaken the invariants above.
