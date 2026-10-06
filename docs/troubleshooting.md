# Troubleshooting

## `shopify` was not found

Install Shopify CLI globally and confirm `shopify version` works.

## Setup refuses a file

`init` never overwrites incompatible manual configuration. Reconcile the reported file and rerun; there is no `--force`.

## The layout was not changed

Add the exact renders printed by `init`. It patches only a single unambiguous `</head>` and `</body>`.

## A lock remains after a crash

Confirm no Vite process owns the theme before retrying. Recovery never overwrites a changed snippet.
