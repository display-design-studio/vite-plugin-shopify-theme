# RFC 0002: Controlled tag attributes and inline CSS

- Status: draft
- Target: 0.5.0 (earliest)

Let an entry declare a small, validated set of HTML attributes for its generated tags, and let a stylesheet entry be inlined into the page instead of linked. The root exports, zero runtime dependencies, explicit entries, and deterministic output do not change.

## Problem

Users of Vite plus Shopify themes ask for control over the generated tags:

- Inline critical CSS so it does not block rendering and costs no request (a feature request on the competing plugin, `inline_asset_content`).
- Extra attributes on generated tags such as `fetchpriority`, `media`, or `data-*` (a closed pull request on the same plugin).
- URL-only output for custom markup (another closed pull request there).

Today every entry renders fixed tags, so these needs force users to edit generated files, which are overwritten on every build, or to bypass the plugin.

## Goals

- Keep `entries` backward compatible: a string value keeps its meaning.
- Make every option explicit, validated at configuration time, and rendered in a stable order.
- Never put user input into Liquid unescaped.

## Non-goals

- Automatic entry discovery, runtime framework integrations, tunnels, deployment.
- Arbitrary HTML or Liquid fragments in configuration.
- Per-entry snippet files (tracked separately in the roadmap).

## Proposal

An entry value may be a string or an object:

```ts
shopify({
  entries: {
    'theme.css': { source: 'frontend/entrypoints/theme.css', inline: true },
    'theme.ts': {
      source: 'frontend/entrypoints/theme.ts',
      attributes: { fetchpriority: 'high', 'data-theme-bundle': true },
    },
    'product.ts': 'frontend/entrypoints/product.ts',
  },
});
```

### `attributes`

- Applies to the production `<script>` and `<link rel="stylesheet">` tags of that entry. Development tags receive the same attributes so behavior matches.
- Names match `^[a-z][a-z0-9-]*$`. Values are strings or `true`. A `true` value renders as a boolean attribute.
- Reserved and rejected: `src`, `href`, `rel`, `type`, `integrity`, `crossorigin`, and any name starting with `on`. The plugin owns them.
- String values must not contain Liquid output or tag delimiters (double curly braces, or a curly brace followed by a percent sign, and their closing forms) or control characters. Values are HTML-escaped on output.
- Attributes render sorted by name after the plugin's own attributes, so output stays deterministic.
- Preload `<link>` tags do not receive attributes.

### `inline`

- Valid only on stylesheet entries. Rejected for scripts with `CONFIG_ENTRIES`.
- Production renders `<style>{{ 'theme-<hash>.css' | inline_asset_content }}</style>` instead of a `<link>`.
- The built file stays in `assets` and in the ownership record, because the filter reads it from the theme.
- Development ignores `inline` and keeps the Vite `<link>` so HMR continues to work.
- The snippet stays small: it holds the filter call, not the CSS, so the 256 kB snippet limit is unaffected. The rendered page grows by the CSS size, which is the intended trade-off.
- Open item: confirm in Shopify's documentation which asset types `inline_asset_content` accepts and any size limits before implementation.

## Invariants check

| Invariant | Effect |
| --- | --- |
| Explicit entries | Unchanged; options live on the declared entry. |
| Deterministic output | Fixed attribute order; no environment-dependent values. |
| Cleanup boundaries | Unchanged; inlined CSS is still a recorded generated asset. |
| Zero dependencies | No new dependency. |
| Root-only exports | Types extend `ShopifyThemeOptions`; no subpath. |

## Compatibility and migration

Purely additive. String entries behave exactly as before. The diagnostics add no new codes beyond `CONFIG_ENTRIES` messages. README, `docs/configuration.md`, `docs/public-api.md`, and the `scripts/check-pack.mjs` export expectations must be updated together if types are exported.

## Tests

- Unit: normalization accepts strings and objects, rejects reserved names, injection patterns, non-stylesheet `inline`, and unknown keys.
- Unit: rendering order and escaping for attributes; `inline` output; development output ignores `inline`.
- Integration: a build with an inlined stylesheet records the asset, writes the filter call, and keeps ownership state correct across rebuilds.
- Canonical verification: `npm run check`; compatibility matrices because the public option shape changes.

## Open questions

1. Should `attributes` also be accepted globally (one map for all entries)?
2. Is `crossorigin` worth allowing with a validated value, or should it stay plugin-owned?
3. Should URL-only output (no tag) be part of this RFC or the per-entry snippet RFC?
