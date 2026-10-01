# Changelog

All notable changes to this package are documented here.

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
