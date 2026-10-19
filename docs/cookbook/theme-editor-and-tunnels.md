# Live Theme Editor

Goal: edit sections in the Shopify Theme Editor and see style and script changes without rebuilding by hand.

The Theme Editor runs on an HTTPS Shopify origin, so it cannot load assets from `http://localhost`. There are two ways around that.

## Recommended: editor mode (no tunnel)

```sh
npm run dev:editor
```

This runs `vite build --watch` and `shopify theme dev` together. Hashed assets are built and synced to your development theme, and the page reloads after each sync. Nothing outside the project is needed. Open the editor URL printed by Shopify CLI, change a Liquid file or a source file (including a new Tailwind class), and the editor updates in about a second or two.

Things to know:

- It is a rebuild and upload per change, not HMR, so expect a short delay and a full-page reload.
- Right after a change the page can briefly render without styles because Shopify CLI uploads files in no fixed order. Reload if it does not settle.
- Set your store in `shopify.theme.toml` so Shopify CLI does not ask for it, as for `dev`. See [Development modes](../development-modes#editor-mode).

### Why editor mode is not the default

`npm run dev` stays on HMR, and editor mode is opt-in, for these reasons:

- **Speed.** HMR updates the local preview instantly and uploads nothing. Editor mode rebuilds and uploads on every change, about 1-2 seconds plus a full-page reload.
- **Shared remote theme.** Every change is written to your Shopify development theme. Shopify CLI keeps one development theme per store on your machine, so every project on that store shares it.
- **Upload order.** Shopify CLI does not guarantee the order of uploads, so a page can briefly render without styles right after a change.
- **Less proven.** Editor mode is newer than HMR. It has been verified with npm and bun on macOS, not yet with pnpm, Yarn, or Windows, nor under many rapid edits.
- **Compatibility.** Making it the default would change what `npm run dev` does in existing projects.

Use `dev` for day-to-day work in the local preview and `dev:editor` when you edit in the Theme Editor. If your team works mostly in the editor, make it your default in `package.json`:

```json
"scripts": { "dev": "vite-shopify-theme dev --editor" }
```

The default may change once editor mode has seen wider use.

## Alternative: HMR through a tunnel (deprecated)

> `devOrigin` and this tunnel setup are deprecated. The plugin warns with `DEV_ORIGIN_DEPRECATED` when `devOrigin` is set, and the option is removed in 1.0.0. Use editor mode above, which needs no tunnel. If you rely on a tunnel for something editor mode cannot do, say so in an issue before 1.0.0.

Use this when you need instant HMR inside the editor and are willing to manage a tunnel. Route an HTTPS tunnel to Vite and tell the plugin its public origin. The plugin does not create or stop the tunnel.

## Steps

1. Pick a fixed Vite port so the tunnel target never changes:

   ```ts
   // vite.config.ts
   export default defineConfig({
     server: { port: 5173, strictPort: true },
     plugins: [shopify({ entries, devOrigin: process.env.VITE_DEV_ORIGIN })],
   });
   ```

2. Start a tunnel with the provider you prefer and copy its HTTPS origin, for example:

   ```sh
   cloudflared tunnel --url http://localhost:5173
   ```

3. Export the origin (no path, no trailing slash) and start the default development mode:

   ```sh
   VITE_DEV_ORIGIN=https://your-tunnel.example npm run dev
   ```

   When `VITE_DEV_ORIGIN` is unset, `devOrigin` is `undefined` and the plugin uses the local Vite origin.

4. Open the editor URL printed by Shopify CLI. Styles and scripts load from the tunnel and update live.

## What the plugin configures for you

With `devOrigin` set, Vite is configured with:

- `allowedHosts` for the tunnel hostname.
- A secure WebSocket (`wss`) on the tunnel host, port 443, for HMR.
- CORS responses for requests from `localhost`, the tunnel origin, and HTTPS `*.myshopify.com` and `*.shopify.com` pages (storefront preview, Theme Editor, admin).

::: warning Custom storefront domains
Pages served from a custom domain are not in the CORS allow list. If the editor loads your store through a custom domain and assets are blocked, use editor mode, or open the store through its `*.myshopify.com` address.
:::

## Build snapshot

Without either mode, run `vite build`, then `shopify theme dev`. The editor uses the uploaded hashed assets and does not change until you rebuild.

## If something is missing in the editor

| Symptom | Check |
| --- | --- |
| Unstyled page, CORS error in the console | The request goes to the tunnel origin; the page origin is a custom domain (see warning). |
| Vite reports a blocked request or disallowed host | `devOrigin` hostname differs from the tunnel hostname actually in use. |
| HMR never connects | The tunnel must forward WebSockets. Probe the tunnel URL directly. |
| Tunnel URL changed | Restart `dev` with the new `VITE_DEV_ORIGIN`; origins must be stable during a run. A quick-tunnel URL changes on every start, so pass it through the environment rather than writing it into the config. |
| `console.log` appears twice in the editor | Expected: the editor loads the page in two iframes (preview and section picker). |

See [Troubleshooting](../troubleshooting) for the boundary-first checklist and [Advanced workflows](../advanced-workflows#external-tunnels).
