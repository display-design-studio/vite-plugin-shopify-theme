# Upstream provenance

- Repository: https://github.com/Shopify/skeleton-theme
- Branch: `main`
- Commit: `a4f32d393b9eadf6c4403318ca39116832e5d1df`
- Retrieved: 2026-09-30

The snapshot is unchanged except for the local integration overlay: `package.json`,
`package-lock.json`, `vite.config.ts`, Tailwind CSS development dependencies,
`frontend/entrypoints/`, generated
`snippets/vite-tag.liquid`, two renders in `layout/theme.liquid`, and Vite-related
ignore entries. Upstream manual assets, including `assets/critical.css` and SVGs,
remain source-controlled and are never broadly cleaned by the plugin.

## Refresh procedure

1. Clone the desired official commit into a temporary directory and verify its full SHA.
2. Replace only the upstream snapshot files, preserving the integration overlay listed above.
3. Update the commit and retrieval date in this file; review upstream layout changes before reapplying the two renders.
4. Run `npm install`, `npm --prefix playground/skeleton-theme install`, `npm test`, `npm run playground:build`, and Shopify Theme Check.
5. Review the diff deliberately and confirm `critical.css` and all upstream images remain present.
