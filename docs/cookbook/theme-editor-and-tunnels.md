# Live Theme Editor

Goal: edit sections in the Shopify Theme Editor and see style and script changes without rebuilding by hand.

The Theme Editor runs on an HTTPS Shopify origin, so it cannot load assets from the local Vite development server. Use editor mode to build and sync assets through Shopify CLI.

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

## Build snapshot

For a one-time preview, run `vite build`, then `shopify theme dev`. The editor uses the uploaded hashed assets and does not change until you rebuild.

## If something is missing in the editor

| Symptom | Check |
| --- | --- |
| Unstyled page after a change | Shopify CLI may still be uploading the new stylesheet; wait briefly and reload. |
| `console.log` appears twice in the editor | Expected: the editor loads the page in two iframes (preview and section picker). |

See [Troubleshooting](../troubleshooting) for the boundary-first checklist and [Advanced workflows](../advanced-workflows#theme-editor-and-app-extensions).
