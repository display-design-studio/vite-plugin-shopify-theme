# 3. Development Modes

`npm run dev` runs installed Vite through Node and `shopify theme dev` in the current directory. Arguments are forwarded to Vite: `npm run dev -- --host 0.0.0.0`. A `--` separator sends everything after it to `shopify theme dev` instead, for example `vite-shopify-theme dev --host 0.0.0.0 -- --theme 123456789` (through a package script, add the separator your package manager needs before the arguments). Vite starts first, and Shopify CLI starts only after the plugin has written the development snippet, so the first sync includes `snippets/vite-tag.liquid`. If the snippet is not written within 30 seconds, a warning is printed and Shopify CLI starts anyway.

## Editor mode

`npm run dev:editor` (or `vite-shopify-theme dev --editor`) gives the same live updates in the Theme Editor as in the local preview, without a tunnel or any external tool. Instead of serving assets from the Vite dev server, it runs `vite build --watch` and lets Shopify CLI sync the hashed build output to your development theme. Shopify CLI starts after the first successful build, and it runs with `--live-reload full-page` so the page reloads after every sync. Pass `--live-reload` (or set `SHOPIFY_FLAG_LIVE_RELOAD`) to choose another mode.

Choose a mode by where you work:

| Mode | Local preview | Theme Editor | Per-change latency |
| --- | --- | --- | --- |
| `dev` (default) | Instant, with HMR | Only through a tunnel and `devOrigin` | None |
| `dev --editor` | About 1-2 seconds, full-page reload | Yes, no tunnel | About 1-2 seconds, plus upload |
| `vite build`, then `shopify theme dev` | Snapshot | Snapshot | Rebuild by hand |

How it behaves:

- Assets keep content-hashed names. The plugin holds one ownership lock for the whole session and writes the snippet shortly after the assets it references.
- The previous build's assets stay in `assets/` for one more build, and an asset is deleted only after two builds in a row no longer produce it. The Shopify CLI upload order is not guaranteed, so a page may briefly render without styles right after a change; a reload fixes it.
- A failed build keeps the last working assets and snippet and the session continues after the next fix.
- Stopping the command releases the lock. The snippet stays as the generated build output (it is not restored to a placeholder as in `dev`), and the last two builds stay in `assets/` until the next build removes the older one.
- Tailwind classes used only in Liquid files are picked up because Tailwind watches those files.

## Shopify environment

Create `shopify.theme.toml` in the theme root (keep it out of git; `init` ignores it):

```toml
[environments.development]
store = "your-store.myshopify.com"
```

When this file defines `[environments.development]`, `dev` runs `shopify theme dev --environment development`, so Shopify CLI does not ask for a store each time. `init` writes `example.shopify.theme.toml` as a template: copy it to `shopify.theme.toml` and set your store. Pass `-e <name>` or `--environment <name>` after `--`, or set `SHOPIFY_FLAG_ENVIRONMENT`, to choose another environment; `dev` then adds nothing.

The command preserves `SHOPIFY_FLAG_PATH`, forwards termination signals, stops the sibling process when either exits, and propagates failures. On Windows, a shell is used only for the Shopify shim.

Set `devOrigin` to an HTTPS origin when a tunnel is managed elsewhere and you want HMR inside the Theme Editor. During development the snippet contains HMR and reload clients; the previous snippet is restored at shutdown. A live or uncertain lock fails safely.

Shopify CLI flags can be supplied through its documented environment variables. In particular, an existing `SHOPIFY_FLAG_PATH` is passed through unchanged, which is useful when the command runs from a workspace root. Positional arguments after `dev` belong to Vite; they are not forwarded to Shopify CLI.

The command exits when either child exits and terminates the sibling. Spawn errors and non-zero exits produce a failing command. `SIGINT` and `SIGTERM` are forwarded so the plugin can restore the exact pre-development snippet before the processes finish.
