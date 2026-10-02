# Contributing

Thanks for helping improve `@display-studio/vite-plugin-shopify-theme`.

## Before opening an issue

- Use the bug or feature request template and search existing issues first.
- Include the plugin, Node.js, Vite, Shopify CLI, operating system, and package-manager versions when reporting a problem.
- Reduce bugs to an explicit `entries` configuration and a minimal theme structure when possible.
- Never include store passwords, Theme Access passwords, tokens, private preview URLs, or customer data.

Security reports must follow [SECURITY.md](SECURITY.md), not a public issue.

## Development setup

```sh
npm ci
npm ci --prefix playground/skeleton-theme
npm run check
```

The compatibility matrices install packed copies and require network access:

```sh
npm run compat
npm run compat:frameworks
```

The credentialed Shopify end-to-end test is optional and must use environment variables as documented in the README. Credentials must never be stored in files, shell history, fixtures, logs, commits, or GitHub configuration.

## Project boundaries

Changes must preserve the core invariants:

- Entry names and source paths remain explicit.
- The published package has zero runtime dependencies.
- Generated output remains deterministic.
- Cleanup is limited to flat asset files recorded as plugin-owned.
- A live or uncertain lock fails safely.
- The plugin does not manage tunnels, run Shopify CLI, or deploy themes.

Follow the responsibility boundaries in [`AGENTS.md`](AGENTS.md). Avoid unrelated formatting or updates to the vendored Skeleton Theme playground.

## Pull requests

1. Create a focused branch and add tests with behavior changes.
2. Update README, support tables, package checks, and compatibility coverage when changing public options, engines, peers, exports, or published files.
3. Run `npm run check` and `git diff --check`.
4. Run the relevant network-dependent compatibility command when changing Vite, Shopify CLI, or framework interoperability.
5. Describe the user-visible behavior, failure modes, verification performed, and any follow-up work in the pull request.

Changes to the public API should start with a focused issue linked from the [roadmap](https://github.com/display-design-studio/vite-plugin-shopify-theme/issues/1).
