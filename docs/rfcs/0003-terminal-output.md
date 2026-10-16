# RFC 0003: Clear terminal output for `dev` and `dev --editor`

- Status: draft
- Target: 0.7.0

Give `vite-shopify-theme dev` and `dev --editor` a short, stable status view in the terminal: what is running, against which store, where the assets come from, and what happened on every rebuild. Shopify CLI's own output stays untouched. The root exports, zero runtime dependencies, explicit entries, and deterministic generated files do not change.

## Problem

Today the command spawns Vite and `shopify theme dev` with inherited output (`src/cli/dev.ts`). A session on a migrated real theme printed, in this order and without any grouping:

1. Vite's banner and `Local: http://localhost:5173/` lines. Nobody opens that URL; the preview is Shopify's.
2. One plugin line: `[shopify-theme] Development assets ready at http://localhost:5173 (2 entries; snippet: snippets/vite-tag.liquid).`
3. Shopify CLI's boxed `info` panel (`Using applicable flags from development environment`).
4. A long run of Shopify `warning` panels, for example `Directory pattern may be misleading` for each `.shopifyignore` entry, and later theme-check template errors.

The result is hard to scan. The developer cannot tell at a glance which mode is running, which store is targeted, whether the last rebuild worked, or which messages come from the plugin and which from the theme. Several of the messages are fixable setup problems that the plugin could name, such as a `.gitignore` missing the generated-file patterns that cause endless rebuilds in `dev --editor`.

## Goals

- A compact header at startup and a footer at shutdown, plus one stable line per rebuild in editor mode.
- Never hide or rewrite Shopify CLI output, prompts, colors, or exit codes.
- Readable in a plain terminal, in CI, and when piped: no ANSI and the same facts when the output is not a TTY.
- Keep every existing diagnostic code searchable and unchanged.

## Non-goals

- Parsing, filtering, or re-rendering Shopify CLI output. It has no machine-readable mode (`shopify theme dev --help` offers `--no-color`, `--verbose`, `--notify`, and `--error-overlay` only), its text changes between versions, and capturing it through a pipe breaks its interactive keys and login prompts. A pseudo-terminal would need a runtime dependency.
- A full-screen or interactive dashboard.
- Changing Vite's own logging beyond the dev banner described below.
- Tunnel management or deployment.

## Proposal

### Header

Printed once by `vite-shopify-theme dev`, before Vite and Shopify CLI start:

```text
vite-shopify-theme 0.7.0 · HMR
  store     alessi-dev.myshopify.com (environment: development)
  assets    http://localhost:5173 · 2 entries
  snippet   snippets/vite-tag.liquid
```

In editor mode the `assets` row reads `built to assets/ and synced by Shopify CLI · live reload: full-page`. The store and environment come from `shopify.theme.toml` and the flags after `--`, which the command already reads to select the environment; the row is omitted when they cannot be determined. The Shopify preview URL is shown only when it follows from flags (`--host`, `--port`); otherwise the header points at Shopify's own lines instead of guessing.

### Vite banner

Under `vite-shopify-theme dev`, the plugin replaces Vite's `Local/Network/press h` URL block with nothing, because the header already names the asset origin. Running `vite` directly keeps Vite's default output.

### Rebuild lines (editor mode)

One line per build, with a stable prefix and timing:

```text
[shopify-theme] build ok · 4 entries · 312 ms · snippet unchanged
[shopify-theme] build failed · keeping the last good output (still synced)
```

A failed build keeps showing Vite's own error above this line.

### Footer

Printed after both processes exit, naming what was left behind: `Stopped. Development snippet restored.` in HMR mode, `Stopped. Generated snippet kept; run vite build before deploying.` in editor mode (see the Editor mode section of `docs/development-modes.md`: stopping keeps the generated build snippet and the last two builds in `assets/`). The exit code is unchanged.

### Preflight hints (second phase)

Before starting Shopify CLI, a short list of setup problems the plugin can detect cheaply, each with a documentation link and shown once:

- `.shopifyignore` directory patterns without a trailing `/*` (the source of the Shopify warnings above).
- Missing generated-file patterns in `.gitignore` (the cause of rebuild loops under Tailwind).
- Layouts still rendering the snippet with the old `with 'entry'` syntax.

Hints never block startup and never edit files.

### Control

- Plain output when stdout is not a TTY, `CI` is set, or `NO_COLOR` is set; ANSI colors otherwise (no color library).
- `vite-shopify-theme dev --raw` prints today's output exactly: no header, footer, hints, or Vite banner change.

## Invariants check

| Invariant | Effect |
| --- | --- |
| Explicit entries | Unchanged. |
| Deterministic output | Generated files are untouched; only terminal text changes. |
| Cleanup boundaries | Unchanged. |
| Zero dependencies | Plain ANSI escapes and Node APIs only. |
| Root-only exports | No new export; the CLI is not a library entry. |

## Compatibility and migration

Terminal text is not a stable interface except diagnostic codes (`[shopify-theme:CODE]`), which keep their format. Scripts that grep the old plugin line or Vite's banner should use `--raw` or the diagnostic codes. The existing `[shopify-theme] Development assets ready ...` line is replaced by the header, with the same facts. Document in the changelog and `docs/development-modes.md`.

## Tests

- Unit: header and footer formatting for both modes, with and without color, with missing store information, at narrow widths.
- Unit: TTY, non-TTY, `CI`, and `NO_COLOR` selection; `--raw` leaves output identical to today's.
- Integration with fake child processes: ordering of header, children output, and footer; exit codes and signal forwarding unchanged; Shopify output bytes pass through unmodified.
- Integration: rebuild lines for a successful and a failed watch build.
- Canonical verification: `npm run check`; a manual run against a real store in both modes, since the Shopify E2E workflow only covers HMR.

## Decisions

1. **Shopify CLI output is passed through, never parsed.** Parsing is fragile across Shopify CLI versions (the compatibility matrix covers 3.x and 4.x) and a pipe or pseudo-terminal would break its prompts. The plugin owns only its own lines.
2. **A header and footer rather than a dashboard.** They give the at-a-glance facts without redrawing the screen, so they work in every terminal and in logs.
3. **Preflight hints come second.** They add the most value for new setups but need their own detection rules; the header, footer, and rebuild lines ship first.
4. **`--raw` instead of a verbosity ladder.** One escape hatch that restores today's behavior is enough until a concrete need appears.

## Open questions

- Print the header on stdout or stderr. Stderr keeps `stdout` clean for tools, but some terminals color it as an error.
- Whether Windows consoles without ANSI support need an explicit plain fallback, or `NO_COLOR` handling is enough.
- Whether to show the Shopify preview URL by reading Shopify CLI's default port, or only when flags make it certain.

## Implementation order

1. Formatter module for header, footer, and rebuild lines with TTY and color selection, plus unit tests.
2. `src/cli/dev.ts`: print header and footer around the existing spawns; add `--raw`; pass an environment flag so the plugin can suppress Vite's URL block.
3. `src/plugin.ts`: replace the development info line and the Vite URL block under the CLI; add rebuild lines in watch mode.
4. Documentation: `docs/development-modes.md`, `docs/troubleshooting.md`, README, and a changelog note.
5. Preflight hints as a separate change, with a test per rule.
6. Manual verification on a real store in both modes before release.
