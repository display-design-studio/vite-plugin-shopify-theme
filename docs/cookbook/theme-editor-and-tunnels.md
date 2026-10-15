# Live Theme Editor with a tunnel

Goal: edit sections in the Shopify Theme Editor while Vite serves live assets with HMR.

The Theme Editor runs on an HTTPS Shopify origin, so it cannot load `http://localhost` assets. Route an HTTPS tunnel to Vite and tell the plugin its public origin. The plugin does not create or stop the tunnel.

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

3. Export the origin (no path, no trailing slash) and start development:

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
Pages served from a custom domain are not in the CORS allow list. If the editor loads your store through a custom domain and assets are blocked, use the build snapshot workflow below, or open the store through its `*.myshopify.com` address.
:::

## No tunnel: sync mode

Run `npm run dev -- --sync`. Vite rebuilds on change, Shopify CLI uploads the hashed assets, and the editor loads them from Shopify. Adding a new Tailwind class to a Liquid file updates the editor without a restart or a tunnel. There is no HMR; each change takes a rebuild and an upload. See [Sync mode](../development-modes#sync-mode).

## Build snapshot alternative

Run `vite build`, then `shopify theme dev`. The editor uses uploaded hashed assets. Rebuild after source changes.

## If something is missing in the editor

| Symptom | Check |
| --- | --- |
| Unstyled page, CORS error in the console | The request goes to the tunnel origin; the page origin is a custom domain (see warning). |
| Vite reports a blocked request or disallowed host | `devOrigin` hostname differs from the tunnel hostname actually in use. |
| HMR never connects | The tunnel must forward WebSockets. Probe the tunnel URL directly. |
| Tunnel URL changed | Restart `dev` with the new `VITE_DEV_ORIGIN`; origins must be stable during a run. |
| `console.log` appears twice in the editor | Expected: the editor loads the page in two iframes (preview and section picker). |

See [Troubleshooting](../troubleshooting) for the boundary-first checklist and [Advanced workflows](../advanced-workflows#external-tunnels).
