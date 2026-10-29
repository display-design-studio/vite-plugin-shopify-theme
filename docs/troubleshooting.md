# Troubleshooting

## `Cannot read properties of null (reading 'edgesOut')` while installing Vite

This is a bug in npm 10.8.2, the npm bundled with Node.js 20.19.0, and it happens with Vite 8.2 or newer even without this plugin ([npm/cli#9787](https://github.com/npm/cli/issues/9787)). Run `npm install --global npm@11` and retry, or use pnpm, Yarn, or Bun. See [Support and Compatibility](./support-compatibility#node-js-20-19-0-and-npm).

## Shopify CLI says "A path was explicitly provided but doesn't exist"

`dev` printed `The theme folder "…" does not exist, so Shopify CLI will stop` before Shopify CLI failed. The folder in `SHOPIFY_FLAG_PATH` (or `--path` after `--`) was not there when Shopify CLI started, which usually means whatever generates it is not running or is too old.

With `@display-studio/vite-plugin-shopify-devtools` and `instrument: 'copy'`, the folder is `.shopify-devtools/theme`. Versions before 0.5.0 removed that mirror as soon as the dev server started, so use 0.5.0 or later. For a 0.x version, a range such as `^0.4.0` never reaches 0.5.0 and a plain `bun update` or `npm update` keeps the old version; install the new one explicitly, for example `bun add -d @display-studio/vite-plugin-shopify-devtools@latest`.

## `shopify` was not found

Install Shopify CLI globally and confirm `shopify version` works.

## Setup refuses a file

`init` never overwrites incompatible manual configuration. Reconcile the reported file and rerun; there is no `--force`.

## The layout was not changed

Add the exact renders printed by `init`. It patches only a single unambiguous `</head>` and `</body>`.

## A lock remains after a crash

Confirm no Vite process owns the theme before retrying. Recovery never overwrites a changed snippet.

## A production build fails with `LOCK_ACTIVE` while `dev` is running

This is intentional. Development temporarily owns the generated snippet, while a production build writes the snippet, hashed assets, manifest, and ownership state. Letting both processes write to the same theme root could mix outputs or make one process remove files still needed by the other.

Stop `dev`, run the production build, then restart `dev`. If the development session must stay open, build from a separate checkout with a separate theme root and separate generated assets, snippet, state, and lock. Do not delete or bypass the lock while either process may still be running.

See [Ownership and recovery](./advanced-workflows#ownership-and-recovery) for the ownership boundary.

## Development URLs point at the wrong host

`devOrigin` is deprecated and will be removed in 1.0.0; prefer `npm run dev:editor`. If you still use it for an externally managed HTTPS tunnel, it must be an origin such as `https://vite.example.test`, not a URL with a path. For direct local development, omit it and let the plugin use Vite's resolved local origin.

## Shopify preview loads but CSS or JavaScript does not

Check that the Liquid render name exactly matches a key in `entries`, inspect the browser request URL, and verify the source file is inside `themeRoot`. Run with `diagnostics: true` and include the resulting diagnostic codes in an issue.

## A build leaves an old generated asset

Do not delete ownership state before investigating. Confirm that the filename is listed in `.vite-shopify-theme.json`; unrecorded files are deliberately never removed. A recorded stale filename remains plugin-owned, so do not manually repurpose generated filenames.

## Styles or scripts are missing only in the Theme Editor

The editor runs on an HTTPS Shopify origin and cannot load `http://localhost`. Run `npm run dev:editor`, which syncs hashed assets to Shopify and needs no tunnel (see [Development modes](./development-modes#editor-mode)), or use an HTTPS tunnel with `devOrigin`; see [Live Theme Editor](./cookbook/theme-editor-and-tunnels). Pages served from a custom storefront domain are not in the development CORS allow list.

## `dev:editor` or `vite build --watch` rebuilds again and again

Tailwind CSS v4 scans every project file that `.gitignore` does not exclude and watches what it finds. Every build rewrites generated files: Vite writes the hashed assets and `assets/vite-manifest.json` even when their content is unchanged, and the plugin updates its lock and ownership state. Tailwind sees the change and starts another build. The hashed assets matter most; ignore all of the files below. A log that repeats `built in ...` many times per second is the sign. `init` writes the ignore patterns that stop it; add them yourself when you set up without `init`:

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
