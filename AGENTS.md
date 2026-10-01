# Repository instructions

This package is a focused Vite 8 plugin for explicit Shopify theme entries. Treat the README invariants as requirements: preserve explicit entries, deterministic generated output, plugin-owned cleanup boundaries, and zero runtime dependencies.

## Internal boundaries

- `src/config.ts` owns option types, validation, normalization, and the Vite config contribution.
- `src/snippets.ts` owns manifest traversal, Liquid rendering, and the virtual reload client.
- `src/ownership.ts` owns atomic writes, asset state, locks, recovery, and cleanup.
- `src/plugin.ts` owns Vite hooks, lifecycle state, local origin detection, and coordination.
- `src/index.ts` is the only public entrypoint. Preserve its default and named exports and do not add package subpath exports without an explicit API decision.

Never delete unrecorded theme assets. Ownership state may name only flat generated asset files. A live or uncertain lock must fail safely; stale development recovery may restore a snippet only when its recorded generated hash still matches. Preserve existing manual snippets and assets on failures.

Unit coverage belongs in `test/unit.test.ts`; filesystem and Vite lifecycle coverage belongs in `test/integration.test.ts`. Run `npm run check` for canonical verification, or the documented individual scripts while iterating. Always run `git diff --check` before committing.

`playground/skeleton-theme` is a vendored upstream snapshot with a small integration overlay. Do not casually reformat or modernize vendored files, regenerate unrelated assets, or replace the snapshot. Follow `playground/skeleton-theme/UPSTREAM.md` for provenance and refreshes, preserving its listed overlay and manual assets.
