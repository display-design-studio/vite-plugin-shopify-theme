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
- Look good without costing speed: no added wait on the startup path, no processing of Shopify CLI's output stream, and no dependency (see "Performance").

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
  versions  Vite 8.3.4 · Shopify CLI 4.9.3 · Node 26.12.0
  store     alessi-dev.myshopify.com (environment: development)
  assets    http://localhost:5173 · 2 entries
  snippet   snippets/vite-tag.liquid
```

In editor mode the `assets` row reads `built to assets/ · synced by Shopify CLI · live reload: full-page`. The store and environment come from `shopify.theme.toml` and the flags after `--`, which the command already reads to select the environment; the row is omitted when they cannot be determined. The Shopify preview URL is shown only when it follows from flags (`--host`, `--port`); otherwise the header points at Shopify's own lines instead of guessing.

### Versions

The `versions` row names Vite, Shopify CLI, and Node, so a bug report starts with the right facts. Vite and Node cost nothing: the command already resolves Vite's `package.json`, and Node is `process.version`. Shopify CLI is read from a local `@shopify/cli/package.json` when the project depends on it, and otherwise from `shopify version`, started in parallel with Vite and given a short timeout. A version that is not known in time is omitted; it never delays startup.

### Shopify CLI section

Shopify CLI's output must stay easy to find and must stay exactly as Shopify prints it. The command prints one rule, `━━ Shopify CLI 4.9.3 ━━━━`, with the name and version in the accent color, right before it starts Shopify CLI. Everything after it, including the `info` panel, preview and Theme Editor URLs, warnings, and errors, is Shopify's own, with its colors and prompts. There is no closing rule in the middle of the stream, because placing one would require reading the output. The footer marks the end.

### Environment flags

Today `dev` passes `--environment development`, so Shopify CLI prints a second `info` panel (`Using applicable flags from development environment`) that repeats what the header already says. When `[environments.development]` in `shopify.theme.toml` holds only plain values (strings, numbers, booleans), the command expands them into the equivalent flags itself and Shopify CLI prints no environment panel, so the session shows one Shopify panel instead of two. Rules:

- A flag the caller already passed after `--`, or `SHOPIFY_FLAG_ENVIRONMENT`, wins, exactly as it does with `--environment` today.
- Anything else in the table (arrays, nested tables, unknown value types) makes the command fall back to `--environment development`, and Shopify's panel appears as before.
- The header reads the same parsed values, so the store and environment rows always match what Shopify receives.
- This ships only if tests show identical behavior to `--environment` on both Shopify CLI lines in the compatibility matrix (3.94.3 and 4.x). Otherwise the fallback stays the only path.

### Shopify CLI keyboard shortcuts

Shopify CLI reads the keyboard itself (`t` local preview, `p` shareable preview, `e` Theme Editor, `g` gift cards, Ctrl+C to quit). The command never reads, buffers, or intercepts stdin, so these keep working and the panel that lists them stays exactly as Shopify prints it.

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

## Performance

The status view must be free for the developer who never reads it.

- **Startup**: the header is built from values the command already has (flags, `shopify.theme.toml`, the resolved Vite package) and written before the first `spawn`, with no `await` added to the critical path. The only new asynchronous work is the optional `shopify version` lookup, which runs in parallel with Vite and has a timeout of about 1.5 s. The wait for the first build or snippet is unchanged.
- **Shopify CLI**: stdio stays inherited, as today. The command does not read, buffer, or rewrite its output, so there is no per-line cost and no change in latency.
- **Rebuilds**: one string and one write per build, produced from numbers the plugin already measures. No timers and no polling.
- **Weight**: plain ANSI escapes, precomputed once, and no dependency. The formatter is a small module loaded only by `dev`; `vite build` and plugin consumers do not import it.
- **Budget**: the change adds well under 5 ms to the time before Shopify CLI starts, measured by a test that compares the time of the first `spawn` with and without `--raw`.

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
- Unit: environment expansion for plain values, the fallback for arrays and nested tables, caller flags and `SHOPIFY_FLAG_ENVIRONMENT` taking precedence.
- Compatibility: on Shopify CLI 3.94.3 and 4.x, expanded flags and `--environment` reach the same store and theme and the environment panel is absent.
- Integration: rebuild lines for a successful and a failed watch build.
- Performance: the header is written before the first `spawn` and adds no awaited work; a missing or slow `shopify version` never delays Shopify CLI's start and only omits the row.
- Canonical verification: `npm run check`; a manual run against a real store in both modes, since the Shopify E2E workflow only covers HMR.

## Decisions

1. **Shopify CLI output is passed through, never parsed.** Parsing is fragile across Shopify CLI versions (the compatibility matrix covers 3.x and 4.x) and a pipe or pseudo-terminal would break its prompts. The plugin owns only its own lines.
2. **A header and footer rather than a dashboard.** They give the at-a-glance facts without redrawing the screen, so they work in every terminal and in logs.
3. **Preflight hints come second.** They add the most value for new setups but need their own detection rules; the header, footer, and rebuild lines ship first.
4. **One rule instead of a framed Shopify section.** A closing rule would need to know where Shopify's output ends, which means reading it. The opening rule and the footer give the same orientation at no cost.
5. **The plugin applies simple environments itself.** One Shopify panel is clearer than two, and the header already shows the store and environment. The fallback to `--environment` keeps unusual setups working unchanged.
6. **`--raw` instead of a verbosity ladder.** One escape hatch that restores today's behavior is enough until a concrete need appears.

## Open questions

- Print the header on stdout or stderr. Stderr keeps `stdout` clean for tools, but some terminals color it as an error.
- Whether Windows consoles without ANSI support need an explicit plain fallback, or `NO_COLOR` handling is enough.
- Whether to show the Shopify preview URL by reading Shopify CLI's default port, or only when flags make it certain.

## Implementation order

1. Formatter module for header, versions, the Shopify CLI rule, footer, and rebuild lines with TTY and color selection, plus unit tests.
2. `src/cli/dev.ts`: print header and footer around the existing spawns, expand simple environments into flags, add `--raw`; pass an environment flag so the plugin can suppress Vite's URL block.
3. `src/plugin.ts`: replace the development info line and the Vite URL block under the CLI; add rebuild lines in watch mode.
4. Documentation: `docs/development-modes.md`, `docs/troubleshooting.md`, README, and a changelog note.
5. Preflight hints as a separate change, with a test per rule.
6. Manual verification on a real store in both modes before release.
