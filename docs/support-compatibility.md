# Support and Compatibility

| Component | Supported |
| --- | --- |
| Node.js | `^20.19.0 || >=22.12.0` |
| Vite | `^8.0.0` |
| Package managers | npm, pnpm, yarn, bun |
| Shopify CLI | External `shopify` command |

## Companion plugin

`@display-studio/vite-plugin-shopify-devtools` runs together with this plugin. Use 0.5.0 or later: earlier versions removed their `.shopify-devtools/theme` mirror when the dev server started, which broke `SHOPIFY_FLAG_PATH=.shopify-devtools/theme`, and they did not remove it on a graceful stop. For a 0.x version, install the new one explicitly (`@latest`), because a `^0.4.0` range does not include 0.5.0. A CI job runs `dev` with both plugins and checks that the mirror exists when Shopify CLI starts and is gone after SIGINT and SIGTERM.

## Node.js 20.19.0 and npm

Node.js 20.19.0 bundles npm 10.8.2. That npm fails with `Cannot read properties of null (reading 'edgesOut')` when it installs Vite 8.2 or newer, with or without this plugin ([npm/cli#9787](https://github.com/npm/cli/issues/9787)). Vite 8.0 and 8.1 install fine. Upgrade npm (`npm install --global npm@11`) or use pnpm, Yarn, or Bun; `init` installs `vite@^8.0.0`, so it hits the same error with the bundled npm. The compatibility matrix runs Node 20.19.0 with the newest Vite on npm 11 for this reason.

Use [GitHub Issues](https://github.com/display-design-studio/vite-plugin-shopify-theme/issues) for support. Network-dependent Vite and Shopify matrices remain separate from canonical offline checks.
