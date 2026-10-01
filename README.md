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

`entries` is authoritative. Every source must exist within `themeRoot`, and both names and sources must be unique. The plugin owns Vite's top-level `input`, disables `publicDir`, uses a relative base, emits flat Shopify-compatible assets, retains manually-authored assets, and deletes only obsolete files recorded by the plugin's preceding successful build.

During `vite` development the snippet points at the resolved local server. Set `SHOPIFY_VITE_ORIGIN=https://stable-tunnel.example` when a separately managed HTTPS tunnel is needed; the plugin configures `server.ws`, CORS, and the allowed host but never starts a tunnel. Build and development processes take exclusive ownership of a theme root. Interrupted development is recovered only when the generated snippet still has the recorded hash, so a manual edit is never overwritten.

The vendored [official Skeleton Theme playground](playground/skeleton-theme) includes a dependency-free Node orchestrator for Vite and `shopify theme dev`. See its [provenance and deliberate refresh procedure](playground/skeleton-theme/UPSTREAM.md).

## Commands

```sh
npm run check
```

Individual checks remain available as `typecheck`, `test`, `build`, `playground:build`, `pack:check`, and `theme:check`.

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

- [ ] Support the expected stylesheet extensions across entry handling and generated tags.
- [ ] Apply CORS attributes consistently to generated development tags.
- [ ] Turn configuration and filesystem failures into actionable diagnostics.
- [ ] Keep startup logging concise and useful.
- [ ] Warn clearly about tunnel ownership, stability, and HTTPS requirements.
- [ ] Document HMR troubleshooting for local and tunneled development.
- [ ] Add repository agent instructions for contributors and automation.

### P2 — Maintainability

- [ ] Separate internal responsibilities for configuration, asset ownership, snippet rendering, and lifecycle state.
- [ ] Expand compatibility fixtures across supported Node, Vite, and Shopify CLI versions.
- [ ] Strengthen package-content and install validation.
- [ ] Document the supported package exports.
- [ ] Publish and maintain a support matrix.

### Barrel reference

Adopt the reference project's useful discipline around explicit entry configuration, deterministic manifests, focused lifecycle handling, actionable diagnostics, and realistic integration fixtures. Intentionally defer its heavier features—automatic entry discovery, proxy ownership, tunnel management, framework-specific helpers, and broader asset orchestration—until they can be justified without weakening the invariants above.
