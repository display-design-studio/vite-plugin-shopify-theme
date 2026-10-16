# Support and Compatibility

| Component | Supported |
| --- | --- |
| Node.js | `^20.19.0 || >=22.12.0` |
| Vite | `^8.0.0` |
| Package managers | npm, pnpm, yarn, bun |
| Shopify CLI | External `shopify` command |

## Node.js 20.19.0 and npm

Node.js 20.19.0 bundles npm 10.8.2. That npm fails with `Cannot read properties of null (reading 'edgesOut')` when it installs Vite 8.2 or newer, with or without this plugin ([npm/cli#9787](https://github.com/npm/cli/issues/9787)). Vite 8.0 and 8.1 install fine. Upgrade npm (`npm install --global npm@11`) or use pnpm, Yarn, or Bun; `init` installs `vite@^8.0.0`, so it hits the same error with the bundled npm. The compatibility matrix runs Node 20.19.0 with the newest Vite on npm 11 for this reason.

Use [GitHub Issues](https://github.com/display-design-studio/vite-plugin-shopify-theme/issues) for support. Network-dependent Vite and Shopify matrices remain separate from canonical offline checks.
