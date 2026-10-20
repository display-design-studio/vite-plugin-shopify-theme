# RFC 0004: The public API for 1.0

- Status: accepted for implementation
- Target: deprecations in 0.7.0, removals in 1.0.0

Decide what the package root exports before the `1.0.0` freeze, deprecate the rest now, and document the contract. The root-only entrypoint, zero runtime dependencies, explicit entries, and deterministic generated output do not change.

## Problem

The root exports more than the documentation describes, and some of it is stale or leaks internals:

| Export | Kind | Documented | Notes |
| --- | --- | --- | --- |
| default, `shopifyTheme` | function | yes | The plugin. |
| `ShopifyThemeOptions`, `EntryOptions` | types | yes | Plugin options and the object form of an entry. |
| `normalizeOptions` | function | no | Internal configuration step. |
| `collectManifestTags`, `ManifestTags` | function, type | no | Internal manifest traversal. |
| `developmentSnippet` | function | no | Internal; the plugin calls it. |
| `productionSnippet` | function | no | Stale: it cannot render `attributes`, `inline`, or the CSS bundle that the plugin renders (`renderProductionSnippet` is the real implementation and is not exported). |
| `NormalizedOptions` | type | no | Its `entryOptions` field uses `NormalizedEntryOptions`, which is not exported, so a public signature points at a private type. |

Evidence on use: none of the helpers appears in the README or the docs; the plugin and the CLI import the internal modules directly, not the root; a public code search for the package name together with each helper finds nothing; and the package is two weeks old (created 2026-10-02), with its downloads dominated by CI. `docs/public-api.md` says only that "existing named helpers and types remain compatible", which promises more than was ever intended.

Diagnostic codes (`[shopify-theme:CODE]`) are a de facto public interface too: users search for them in issues and the troubleshooting page, but they are not listed anywhere as a contract.

## Goals

- A small, documented, typed surface that can be kept stable across 1.x.
- No silent break before 1.0.0: deprecate first, with the replacement named.
- One place that states what is public: the exports, the options, and the diagnostic codes.

## Non-goals

- New exports or subpath imports. The package stays root-only.
- Changing option names, defaults, or behavior.
- A runtime warning for importing a deprecated helper: it would add code and cost to a path nobody is known to use.

## Proposal

### The 1.0 surface

- Runtime: the default export and `shopifyTheme` (identical; the default import stays canonical).
- Types: `ShopifyThemeOptions` and `EntryOptions`.
- Diagnostic codes, as a documented list. A code keeps its meaning within a major version; the message text is not part of the contract.
- The CLI (`vite-shopify-theme init`, `dev`, and their flags) as documented, not as a JavaScript API.

### 0.7.0: deprecate

Mark these exports `@deprecated` in their JSDoc, with the message "Internal; removed in 1.0.0":

- `normalizeOptions`, `collectManifestTags`, `developmentSnippet`, `productionSnippet`
- the types `NormalizedOptions` and `ManifestTags`

Editors then strike them through. Nothing else changes at runtime. Add a Deprecated entry to the changelog and replace the vague sentence in `docs/public-api.md` with the real list.

### 1.0.0: remove

Remove the deprecated exports from `src/index.ts`. The functions stay in their internal modules (`src/config.ts`, `src/snippets.ts`) because the plugin uses them; `productionSnippet`, which nothing uses, is deleted. The unit tests already import most internals from the module paths; the rest move to them.

### Documentation

`docs/public-api.md` lists the exports, the options pointer, and a table of diagnostic codes with a one-line meaning each. A unit test compares the table with the `DiagnosticCode` type, so the table cannot silently drift.

## Invariants check

| Invariant | Effect |
| --- | --- |
| Explicit entries | Unchanged. |
| Deterministic output | Unchanged. |
| Cleanup boundaries | Unchanged. |
| Zero dependencies | Unchanged. |
| Root-only exports | Unchanged; fewer names on the root. |

## Compatibility and migration

0.7.0 only adds `@deprecated` tags and documentation. Code that imports a deprecated helper keeps working until 1.0.0. Anyone depending on `normalizeOptions` or the snippet helpers should open an issue before 1.0.0 describing the use; the answer may be to document and keep one of them.

## Tests

- `scripts/check-pack.mjs` pins the runtime export list and the declaration text (`expectedRuntimeExports` and the `index.d.ts` expectation); both change in the same commits as the exports, as `AGENTS.md` requires. In 0.7.0 the runtime list is unchanged. The deprecated names are re-declared in `src/index.ts` as `@deprecated` aliases (so the plugin's own use of the internals is not flagged), so the `index.d.ts` text changes: it now has the aliased imports and the tagged declarations. The unit tests also keep `docs/public-api.md` in step: its code table must equal the `DiagnosticCode` type, and every root export must be documented as public or deprecated.
- Unit: every `DiagnosticCode` appears in the documentation table and every table row is a real code.
- The 1.0.0 change fails `pack:check` until the contract is updated, which is the intended guard.

## Decisions

1. **Deprecate in 0.7.0 and remove in 1.0.0**, the same path as `devOrigin`, rather than removing in a 0.x minor. The package is young and no use is known, but a deprecation costs one JSDoc tag.
2. **JSDoc deprecation only, no runtime warning.** A warning would need wrapper code on exports nobody is known to use.
3. **Diagnostic codes are part of the contract, message text is not.** Codes are what users and issue reports rely on.
4. **Keep both `shopifyTheme` and the default export.** Removing one gains nothing and breaks the existing documented import styles.

## Implementation order

1. This RFC.
2. 0.7.0: JSDoc deprecations, `docs/public-api.md`, the diagnostic-code table with its test, `check-pack.mjs` declaration expectation, changelog.
3. 1.0.0: remove the exports, update `check-pack.mjs`, and migrate the remaining test imports.
