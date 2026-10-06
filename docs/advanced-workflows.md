# 6. Advanced Workflows

`vite build` writes flat hashed files and a manifest to `assets`, renders deterministic Liquid, then records owned files. Later builds remove only obsolete recorded files; manual assets are never inferred.

Manifest traversal is deterministic, iterative, and cycle-safe. Imported styles appear before scripts and shared JavaScript is preloaded unless `build.modulePreload` is false.

The theme-root lock prevents concurrent writers. Stale recovery restores a previous snippet only when its generated hash still matches. Tunnel creation and deployment are outside the CLI contract.

## Ownership and recovery

`.vite-shopify-theme.json` records only plugin-generated, flat asset filenames. It never claims nested paths or files discovered by pattern. A successful build atomically replaces generated state; obsolete files are deleted only when the prior state recorded them as owned. If cleanup or a write fails, the plugin preserves unrecorded manual assets and reports a coded diagnostic.

Development acquires `.vite-shopify-theme.lock` for the theme root. A live lock, malformed ownership evidence, or a lock whose liveness cannot be established fails closed. After a stale development process, the prior Liquid snippet is restored only if the current file still has the exact generated hash recorded by that process. A manually edited snippet is left untouched.

## Monorepos and multiple themes

Keep one Vite config and one ownership boundary per theme. Set `themeRoot` explicitly when the config is outside the theme and run each development process from the package that owns that config. Do not point two concurrent plugin instances at the same theme root: the lock intentionally rejects that topology.

For repositories containing several themes, give each theme its own `assets`, snippet, state file, scripts, and explicit entry map. Shared source packages can still be imported normally through Vite.

## Theme Editor and app extensions

The generated snippet is ordinary Liquid. Render each named entry where its loading semantics belong: global CSS and the reload client usually go in `<head>`, while storefront JavaScript usually goes before `</body>`. Section-specific entries can be rendered by the relevant section, but they must still be declared in `entries`.

Theme App Extensions have their own Shopify build and deployment lifecycle. Use this plugin only when the extension layout exposes an appropriate theme-like asset/snippet boundary; do not redirect an extension build into a production theme's ownership state.

## External tunnels

Create the tunnel with the provider of your choice, route it to Vite, and set `devOrigin` to its public HTTPS origin. The plugin configures browser-facing HMR URLs and allowed hosts; it does not create, authenticate, or stop the tunnel.
