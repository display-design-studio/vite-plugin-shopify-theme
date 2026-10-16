# Troubleshooting

## `shopify` was not found

Install Shopify CLI globally and confirm `shopify version` works.

## Setup refuses a file

`init` never overwrites incompatible manual configuration. Reconcile the reported file and rerun; there is no `--force`.

## The layout was not changed

Add the exact renders printed by `init`. It patches only a single unambiguous `</head>` and `</body>`.

## A lock remains after a crash

Confirm no Vite process owns the theme before retrying. Recovery never overwrites a changed snippet.

## Development URLs point at the wrong host

Use `devOrigin` only for an externally managed HTTPS tunnel. It must be an origin such as `https://vite.example.test`, not a URL with a path. For direct local development, omit it and let the plugin use Vite's resolved local origin.

## Shopify preview loads but CSS or JavaScript does not

Check that the Liquid render name exactly matches a key in `entries`, inspect the browser request URL, and verify the source file is inside `themeRoot`. Run with `diagnostics: true` and include the resulting diagnostic codes in an issue.

## A build leaves an old generated asset

Do not delete ownership state before investigating. Confirm that the filename is listed in `.vite-shopify-theme.json`; unrecorded files are deliberately never removed. A recorded stale filename remains plugin-owned, so do not manually repurpose generated filenames.

## Styles or scripts are missing only in the Theme Editor

The editor runs on an HTTPS Shopify origin and cannot load `http://localhost`. Run `npm run dev:editor`, which syncs hashed assets to Shopify and needs no tunnel (see [Development modes](./development-modes#editor-mode)), or use an HTTPS tunnel with `devOrigin`; see [Live Theme Editor](./cookbook/theme-editor-and-tunnels). Pages served from a custom storefront domain are not in the development CORS allow list.

## `dev:editor` or `vite build --watch` rebuilds again and again

Tailwind CSS v4 scans every project file that `.gitignore` does not exclude and watches what it finds. The plugin rewrites generated files on every build (`assets/vite-manifest.json`, `.vite-shopify-theme.json`, hashed assets), so Tailwind sees a change and starts another build. A log that repeats `built in ...` many times per second is the sign. `init` writes the ignore patterns that stop it; add them yourself when you set up without `init`:

```gitignore
.vite-shopify-theme.json
.vite-shopify-theme.lock
assets/vite-manifest.json
assets/*-????????.css
assets/*-????????.js
```

## The generated snippet is close to Shopify's size limit

`SNIPPET_SIZE_NEAR_LIMIT` is a warning emitted when the generated snippet reaches about 75% of Shopify's 256 kB theme file limit. It grows with the number of entries and their module preloads. Reduce the number of entries, move optional code behind dynamic `import()`, or set `build.modulePreload: false`.

## An inline stylesheet is rendered as a link

`INLINE_CSS_TOO_LARGE` is a warning: Shopify only inlines assets smaller than 15 KB, so the build rendered a normal `<link>` for that entry instead. Shrink the stylesheet or remove `inline` from the entry. See [Critical CSS](./cookbook/critical-css).

## Shopify reports `Upload Errors` such as `cart.json` already exists with the `liquid` extension

This comes from the remote theme, not the plugin. Shopify CLI keeps one development theme per store on your machine and reuses it for every project. If an earlier project left `templates/cart.liquid` there, the first `dev` of a new project uploads `cart.json` while `cart.liquid` still exists, and Shopify rejects it. Shopify CLI then removes remote files that are missing locally, so running `dev` again usually succeeds. To avoid the error, delete the old development theme first (`shopify theme list`, then `shopify theme delete`), or define `[environments.development]` in `shopify.theme.toml` with a dedicated `theme` for the project.

## Before opening an issue

Include the Node, Vite, plugin, Shopify CLI, operating-system, and package-manager versions; the relevant `entries`, `themeRoot`, `snippet`, and `devOrigin` values; the full coded diagnostic; whether the failure occurs in build or development; and a minimal file tree. Remove store credentials and theme tokens.
