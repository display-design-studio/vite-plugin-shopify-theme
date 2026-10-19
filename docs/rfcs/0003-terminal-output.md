# RFC 0003: Clear terminal output for `dev` and `dev --editor`

- Status: accepted for implementation, scope reduced (see "Considered and dropped")
- Target: 0.7.0

Give `vite-shopify-theme dev` and `dev --editor` a short, stable status view in the terminal: what is running, against which store, and what happened on every rebuild. Shopify CLI's own output stays untouched. The root exports, zero runtime dependencies, explicit entries, and deterministic generated files do not change.

The guiding constraint is weight: the status view must cost almost nothing at startup and add no dependency, so only the parts that earn their place are kept.

## Problem

Today the command spawns Vite and `shopify theme dev` with inherited output (`src/cli/dev.ts`). A session on a migrated real theme printed, in this order and without any grouping:

1. Vite's banner and `Local: http://localhost:5173/` lines.
2. One plugin line: `[shopify-theme] Development assets ready at http://localhost:5173 (2 entries; snippet: snippets/vite-tag.liquid).`
3. Shopify CLI's boxed `info` panel (`Using applicable flags from development environment`).
4. A long run of Shopify `warning` panels, for example `Directory pattern may be misleading` for each `.shopifyignore` entry, and later theme-check template errors.

The developer cannot tell at a glance which mode is running, which store is targeted, whether the last rebuild worked, or which messages come from the plugin and which from the theme. One of the setup problems that cost real time is invisible: a `.gitignore` missing the generated-file patterns causes endless rebuilds in `dev --editor`, and nothing says so.

## Goals

- A compact header at startup and a footer at shutdown, plus one stable line per rebuild in editor mode.
- Never hide or rewrite Shopify CLI output, prompts, colors, keyboard shortcuts, or exit codes.
- Readable in a plain terminal, in CI, and when piped: no ANSI and the same facts when the output is not a TTY.
- Keep every existing diagnostic code searchable and unchanged.
- No added wait on the startup path, no processing of Shopify CLI's output stream, no extra process, and no dependency.

## Non-goals

- Parsing, filtering, or re-rendering Shopify CLI output. It has no machine-readable mode (`shopify theme dev --help` offers `--no-color`, `--verbose`, `--notify`, and `--error-overlay` only), its text changes between versions, and capturing it through a pipe breaks its interactive keys and login prompts. A pseudo-terminal would need a runtime dependency.
- A full-screen or interactive dashboard.
- Reimplementing Shopify CLI logic, such as how it reads environments.
- Changing Vite's own logging beyond running it at the warn level (see "Quieter Vite output").
- Tunnel management or deployment.

## Proposal

### Header (shipped in part 1)

Printed once by `vite-shopify-theme dev`, before Vite and Shopify CLI start, from values the command already has:

```text
vite-shopify-theme 0.7.0 · HMR
  versions  Vite 8.3.4 · Shopify CLI 4.9.3 · Node 26.12.0
  store     alessi-dev.myshopify.com (environment: development)
```

In editor mode an `assets` row reads `built to assets/ · synced by Shopify CLI · live reload: full-page`. The store and environment come from `--store`, `SHOPIFY_FLAG_STORE`, or the selected environment in `shopify.theme.toml`; a row is omitted when its value cannot be determined. The `versions` row names Vite and Node, which cost nothing, and Shopify CLI when the project depends on it (`@shopify/cli/package.json` resolves locally). The command does not spawn `shopify version` to fill it, because that is a process on every startup for a fact that `shopify version` gives on demand.

### Footer (shipped in part 1)

Printed after both processes exit, naming what was left behind: `Stopped. Development snippet restored.` in HMR mode, `Stopped. Generated snippet kept; run vite build before deploying.` in editor mode, or a pointer to the troubleshooting guide when the ownership lock remains. An exit code appears only when a process failed by itself, not after a stop the user requested.

### Shopify CLI rule

The command prints one rule, `━━ Shopify CLI ━━━━`, right before it starts Shopify CLI, so its output is easy to find. Everything after it, including its `info` panels, preview and Theme Editor URLs, keyboard shortcuts, warnings, and errors, is Shopify's own. There is no closing rule, because placing one would require reading the output.

### Shopify CLI keyboard shortcuts

Shopify CLI reads the keyboard itself (`t` local preview, `p` shareable preview, `e` Theme Editor, `g` gift cards, Ctrl+C to quit). The command never reads, buffers, or intercepts stdin, so these keep working.

### Rebuild lines (editor mode)

One line per build, with a stable prefix and timing, from numbers the plugin already measures:

```text
[shopify-theme] build ok · 4 entries · 312 ms · snippet unchanged
[shopify-theme] build failed · keeping the last good output
```

A failed build is followed by Vite's own error.

### Quieter Vite output

Vite's banner (`VITE ready in …`, `Local`, `Network`, `press h + enter`), the plugin's `Development assets ready` line, and the per-build chunk tables repeat what the header and the build lines already say, and nobody opens `localhost:5173`. Under `vite-shopify-theme dev`, Vite runs with `--logLevel warn`, so only warnings and errors remain. It costs one argument and no dependency:

- It applies unless the caller passes their own `--logLevel` (or `-l`) or `--raw`.
- The CLI sets `VITE_SHOPIFY_THEME_CLI=1` for the Vite process, and the plugin then writes its own informational lines (build lines and `diagnostics: true` output) straight to stdout, because they would otherwise be filtered out. Outside the command, such as under a plain `vite build --watch`, they still go through Vite's logger.
- What is hidden: `[vite] hmr update` and page-reload lines, the `Port … is in use` notice (the plugin still uses the real port), the `press h` hint (the shortcuts keep working), and the size table in editor mode. `--raw` or `dev --logLevel info` brings them back.

### Setup hint (editor mode only)

Before starting Shopify CLI in editor mode, the command checks one thing: whether `.gitignore` contains the generated-file patterns that `init` writes. Tailwind CSS v4 scans and watches every file `.gitignore` does not exclude, so missing patterns cause endless rebuilds. When they are missing, one line says so and links to the troubleshooting entry. It reads one small file, never blocks startup, and never edits files. Shopify CLI already warns about `.shopifyignore` patterns itself, so the plugin does not repeat that.

### Control

- Plain output when stdout is not a TTY, `CI` is set, `NO_COLOR` is set, or `TERM` is `dumb`; ANSI colors otherwise, with no color library.
- `vite-shopify-theme dev --raw` prints only Vite and Shopify CLI output, as before: no header, rule, footer, or hint.

## Performance

- **Startup**: the header is built from values the command already has (flags, `shopify.theme.toml`, the resolved Vite package) and written before the first `spawn`, with no `await` added to the critical path. Measured on a development machine, the two lookups it adds (resolving a local `@shopify/cli` and reading `shopify.theme.toml`) take about 0.4 ms together warm and about 1.5 ms cold.
- **Shopify CLI**: stdio stays inherited. The command does not read, buffer, or rewrite its output, so there is no per-line cost and no extra process.
- **Rebuilds**: one string and one write per build. No timers and no polling.
- **Weight**: plain ANSI escapes and no dependency. The formatter is a small module loaded only by `dev`; `vite build` and plugin consumers do not import it.

## Invariants check

| Invariant | Effect |
| --- | --- |
| Explicit entries | Unchanged. |
| Deterministic output | Generated files are untouched; only terminal text changes. |
| Cleanup boundaries | Unchanged. |
| Zero dependencies | Plain ANSI escapes and Node APIs only. |
| Root-only exports | No new export; the CLI is not a library entry. |

## Compatibility and migration

Terminal text is not a stable interface except diagnostic codes (`[shopify-theme:CODE]`), which keep their format. Scripts that grep Vite's or the plugin's lines should use `--raw` or the diagnostic codes. The existing `[shopify-theme] Development assets ready ...` line is unchanged. Documented in the changelog and `docs/development-modes.md`.

## Tests

- Unit: header and footer formatting for both modes, with and without color and with missing store information; TTY, non-TTY, `CI`, and `NO_COLOR` selection; `--raw` prints nothing of its own.
- Integration with fake child processes: ordering of header, children output, and footer; exit codes and signal forwarding unchanged.
- Integration: rebuild lines for a successful and a failed watch build, and for an unchanged snippet.
- Unit: the setup hint appears only in editor mode and only when patterns are missing.
- Canonical verification: `npm run check`; a manual run against a real store in both modes, since the Shopify E2E workflow only covers HMR.

## Decisions

1. **Shopify CLI output is passed through, never parsed.** Parsing is fragile across Shopify CLI versions and a pipe or pseudo-terminal would break its prompts. The plugin owns only its own lines.
2. **A header and footer rather than a dashboard.** They give the at-a-glance facts without redrawing the screen, so they work in every terminal and in logs.
3. **Only what costs almost nothing.** Anything that needs a new process, a duplicate of Shopify CLI's logic, or new coordination between the CLI and the plugin is dropped (next section).
4. **`--raw` instead of a verbosity ladder.** One escape hatch that restores today's behavior is enough until a concrete need appears.
5. **Header, footer, hint, and rebuild lines go to stdout.** The command produces no data on stdout, so nothing is polluted, and some terminals and CI systems color stderr as an error. No special handling for Windows consoles without ANSI; output is plain text when stdout is not a TTY or `NO_COLOR` is set.

## Considered and dropped

Revisit only with a concrete user report.

- **Shopify CLI version from `shopify version`.** An extra process on every startup, for a fact available on demand.
- **An `assets` row in HMR mode.** The origin is only known once Vite has started, and it is not information a Shopify developer acts on.
- **Expanding `[environments.development]` into flags to avoid Shopify's second `info` panel.** It duplicates Shopify CLI's environment handling, can drift between versions, and needs its own compatibility tests, only to remove one panel.
- **A header preview URL.** Shopify CLI prints it in its own panel.
- **Preflight hints for `.shopifyignore` patterns and the old render syntax.** Shopify CLI already warns about the first, and the second is covered by the setup documentation.

## Implementation order

1. Header, footer, formatter, and `--raw` (part 1, [#59](https://github.com/display-design-studio/vite-plugin-shopify-theme/pull/59)).
2. The Shopify CLI rule, rebuild lines in editor mode, and the setup hint, with tests and documentation.
3. Manual verification on a real store in both modes before release.
