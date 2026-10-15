# 3. Development Modes

`npm run dev` runs installed Vite through Node and `shopify theme dev` in the current directory. Arguments are forwarded to Vite: `npm run dev -- --host 0.0.0.0`. A `--` separator sends everything after it to `shopify theme dev` instead, for example `vite-shopify-theme dev --host 0.0.0.0 -- --theme 123456789` (through a package script, add the separator your package manager needs before the arguments). Vite starts first, and Shopify CLI starts only after the plugin has written the development snippet, so the first sync includes `snippets/vite-tag.liquid`. If the snippet is not written within 30 seconds, a warning is printed and Shopify CLI starts anyway.

## Choosing a mode

| Mode | Command | Best for | Trade-off |
| --- | --- | --- | --- |
| HMR (default) | `npm run dev` | Local preview at `127.0.0.1:9292` | The Theme Editor may block `http://localhost` assets |
| Sync | `npm run dev -- --sync` | Theme Editor and local preview, no tunnel | No HMR: each change takes a rebuild and an upload (about a second or two) |
| HMR + tunnel | `npm run dev` with `devOrigin` | Live HMR inside the Theme Editor | You run and keep stable an HTTPS tunnel |

## Sync mode

```sh
npm run dev -- --sync
```

Vite runs as `vite build --watch`, and Shopify CLI starts after the first build is published. Assets are the same hashed files a production build creates, uploaded by Shopify CLI, so the Theme Editor never depends on `localhost` or a tunnel.

On every change to a source file, or to a Liquid file Tailwind scans:

1. Vite rebuilds incrementally and writes new hashed assets.
2. The plugin updates `snippets/vite-tag.liquid` after the assets, and only when its content changed.
3. Shopify CLI uploads the new files and refreshes the preview.

You will see one line per rebuild, for example `[shopify-theme] Synced 1 new asset; snippet updated.`

- **Failures keep the last working version.** A compile error leaves the snippet and assets untouched and the watcher keeps running; fix the file and it recovers.
- **Older assets stay only during the session.** Shopify uploads are not ordered, so the plugin keeps the last 10 generations of hashed assets in `assets/` while it runs. When you stop, only the assets the snippet names remain, and a crash's leftovers are removed on the next start. Unrecorded files are never touched.
- **The snippet stays a production snippet** when you stop with Ctrl+C: it references the last published assets, like after `vite build`. A live or uncertain lock still fails safely.
- If the first build takes longer than 120 seconds, a warning is printed and Shopify CLI starts anyway.
- The default HMR mode is unchanged. `--sync` is not forwarded to Shopify CLI; use it before `--`.

## Shopify environment

Create `shopify.theme.toml` in the theme root (keep it out of git; `init` ignores it):

```toml
[environments.development]
store = "your-store.myshopify.com"
```

When this file defines `[environments.development]`, `dev` runs `shopify theme dev --environment development`, so Shopify CLI does not ask for a store each time. `init` writes `example.shopify.theme.toml` as a template: copy it to `shopify.theme.toml` and set your store. Pass `-e <name>` or `--environment <name>` after `--`, or set `SHOPIFY_FLAG_ENVIRONMENT`, to choose another environment; `dev` then adds nothing.

The command preserves `SHOPIFY_FLAG_PATH`, forwards termination signals, stops the sibling process when either exits, and propagates failures. On Windows, a shell is used only for the Shopify shim.

Set `devOrigin` to an HTTPS origin when a tunnel is managed elsewhere. During development the snippet contains HMR and reload clients; the previous snippet is restored at shutdown. A live or uncertain lock fails safely.

Shopify CLI flags can be supplied through its documented environment variables. In particular, an existing `SHOPIFY_FLAG_PATH` is passed through unchanged, which is useful when the command runs from a workspace root. Positional arguments after `dev` belong to Vite; they are not forwarded to Shopify CLI.

The command exits when either child exits and terminates the sibling. Spawn errors and non-zero exits produce a failing command. `SIGINT` and `SIGTERM` are forwarded so the plugin can restore the exact pre-development snippet before the processes finish.
