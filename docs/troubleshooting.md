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

## Before opening an issue

Include the Node, Vite, plugin, Shopify CLI, operating-system, and package-manager versions; the relevant `entries`, `themeRoot`, `snippet`, and `devOrigin` values; the full coded diagnostic; whether the failure occurs in build or development; and a minimal file tree. Remove store credentials and theme tokens.
