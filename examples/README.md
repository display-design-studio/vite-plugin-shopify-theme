# Examples

These minimal Shopify theme roots demonstrate the same plugin contract with three frontend stacks:

- [`vanilla`](vanilla): TypeScript and CSS with Vite.
- [`vue`](vue): independently mounted Vue 3 section application.
- [`react`](react): independently mounted React 19 section application with the Vite React preamble.

Each example is intentionally small and uses this repository through a local `file:../..` dependency. From an example directory, run:

```sh
npm install
npm run build
```

The build writes hashed files and `vite-manifest.json` to `assets`, generates `snippets/vite-tag.liquid`, and records owned assets in `.vite-shopify-theme.json`. These generated files are ignored by Git.

For an actual storefront preview, point Shopify CLI at the example directory in one terminal and start Vite in another:

```sh
npm run dev
shopify theme dev --path .
```

The examples focus on frontend integration rather than providing complete production themes. The repository's `playground/skeleton-theme` is the full Shopify development fixture.
