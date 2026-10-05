# Changelog

All notable changes to this package are documented here.

## Unreleased

### Added

- Added stable, searchable diagnostic codes to every plugin-authored error and warning, with a documented code reference for troubleshooting.
- Added opt-in `diagnostics` lifecycle logging through Vite's logger, including stable events for configuration, ownership, build output, development restoration, and hot reloads.
- Added early `THEME_STRUCTURE_INVALID` diagnostics for missing or non-directory Shopify assets and configured snippet directories.

## 0.3.0

### Added

- Added canonical real-path enforcement for symlinked theme roots, entries, generated snippets, assets, ownership state, locks, manifests, and development recovery.
- Added large-manifest, repeated crash-recovery, high-volume cleanup, and symlink-policy coverage.
- Added Linux, macOS, and Windows canonical CI, npm 10.8.2/latest packaging checks, and packed-package consumer builds with npm, pnpm, Yarn, and Bun.
- Added an approval-protected, manual Shopify end-to-end workflow for `main`.

### Changed

- Replaced recursive manifest traversal with deterministic iterative traversal for deeply nested and cyclic graphs.
- Unified npm Trusted Publishing and GitHub Release creation in the protected tag-driven workflow, including integrity-safe reruns.

## 0.2.1

### Added

- Documented official Vue and React composition recipes, including React Fast Refresh setup for Shopify-rendered HTML and independently mounted section applications.
- Documented the supported module-preload, asset-versioning, and provider-agnostic HTTPS tunnel policies without adding runtime dependencies or public APIs.
- Added network-dependent Vue 3 and React 19 compatibility fixtures covering production builds, generated manifests and snippets, development module serving, React's preamble, and snippet restoration.

### Changed

- Renamed the public package to `@display-studio/vite-plugin-shopify-theme` and aligned its repository metadata with the `display-design-studio` GitHub organization.
- Restricted Liquid-facing entry names to `[A-Za-z0-9][A-Za-z0-9._-]*` so generated case branches cannot be altered by quotes, whitespace, path separators, or Liquid syntax.
- Closed the P4 interoperability evaluation with framework composition, preload/versioning, and externally managed tunnel decisions that preserve the plugin's focused ownership boundary.

## 0.2.0

### Breaking changes

- Replaced the `entry` option with the required `entries` map. Entry names are now explicit and are the values passed to the generated Liquid snippet.
- Removed the `shopify-theme` executable and its legacy CLI options. Development now uses Vite and Shopify CLI as separate processes.
- Made `themeRoot` the boundary for entry resolution, generated snippets, Shopify assets, ownership state, and process locking.
- `shopifyTheme()` now accepts the explicit configuration documented in the README and returns one Vite plugin rather than a plugin array.
- The package is ESM-only, has zero runtime dependencies, and exposes only its root entrypoint.
- Supported Node.js versions are now `^20.19.0 || >=22.12.0`, matching the Vite 8 requirement.

### Added

- Deterministic production snippets, development HMR and theme reload support, plugin-owned asset cleanup, locking, and crash recovery.
- Package-contract validation for published files, metadata, exports, types, installation, and blocked internal subpaths.
- Canonical CI on Node.js 24 and separate Vite/Shopify CLI compatibility coverage.
