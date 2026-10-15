# Working with AI agents

This page is for coding agents and for people writing instructions for them. Everything here is a fact about the plugin, not a preference.

## Invariants agents must preserve

- Entries are explicit. Never add glob or auto-discovery logic. Every Liquid-facing entry is a key in `entries`.
- `snippets/vite-tag.liquid` is generated. Do not edit it by hand; it is overwritten by `dev` and `build`.
- `.vite-shopify-theme.json` and `.vite-shopify-theme.lock/` belong to the plugin. Never edit, commit, or delete them to "fix" a problem; read the diagnostic first.
- Only flat files recorded in the ownership state are ever deleted. Do not delete other files in `assets/`.
- Do not set `build.outDir`, `base`, `publicDir`, `appType`, `input`, or `build.manifest` in Vite config; the plugin owns them and rejects conflicts (`CONFIG_VITE_CONFLICT`).
- The plugin has zero runtime dependencies and one public entrypoint. Do not add subpath imports.

## Task recipes

**Add an entry**

1. Create the source file, for example `frontend/entrypoints/product.ts`.
2. Add it to `entries` in `vite.config.ts` with a flat key: `'product.ts': 'frontend/entrypoints/product.ts'`.
3. Render it in Liquid: `{% render 'vite-tag', entry: 'product.ts' %}`.
4. Run `npm run build` and confirm the snippet has a `{% when 'product.ts' %}` block.

**Start development**: `npm run dev` runs Vite first and Shopify CLI after the development snippet exists. Prefer it over starting `shopify theme dev` separately, so the first sync includes the snippet. Store settings live in `shopify.theme.toml` (`[environments.development]`); `dev` selects that environment automatically, and options after `--` go to Shopify CLI.

**Theme Editor**: `npm run dev:editor` builds in watch mode and syncs hashed assets to the development theme, so changes appear live in the editor without a tunnel. Prefer it over a tunnel unless HMR inside the editor is needed.

**Production assets**: `npm run build`, then upload the theme with Shopify CLI.

**Debug**: set `diagnostics: true` in the plugin options. Messages look like `[shopify-theme:CODE] ...`; the code names the failing boundary. See [Troubleshooting](./troubleshooting).

## Commands

| Command | Purpose |
| --- | --- |
| `npx @display-studio/vite-plugin-shopify-theme init [dir] --yes` | Configure or create a theme |
| `npm run dev` | Vite plus Shopify CLI (HMR) |
| `npm run dev:editor` | Watch build plus Shopify CLI (live Theme Editor, no tunnel) |
| `npm run build` | Generate assets and snippet |

## Copyable `AGENTS.md` for a theme project

````md
# Shopify theme with vite-plugin-shopify-theme

- Frontend source is in `frontend/`; Liquid-facing entries are declared in `vite.config.ts` under `entries`.
- Add a page script: create the file, add a flat key to `entries`, render `{% render 'vite-tag', entry: 'name.ts' %}`.
- Never edit `snippets/vite-tag.liquid`, `.vite-shopify-theme.json`, or `.vite-shopify-theme.lock/`; they are generated.
- Do not delete files in `assets/` that you did not create; only generated files are recorded and removable.
- `npm run dev` starts Vite and Shopify CLI. `npm run dev:editor` does the same with synced assets for the Theme Editor. `npm run build` produces assets for upload.
- Diagnostics: errors start with `[shopify-theme:CODE]`. Full docs: https://display-design-studio.github.io/vite-plugin-shopify-theme/
- Shopify skills for agents: `npx skills add Shopify/shopify-ai-toolkit` (opt-in; read its telemetry notice first).
````

## Where agents should read next

[Getting started](./getting-started), [Configuration](./configuration), [Cookbook](./cookbook/), [Troubleshooting](./troubleshooting).
