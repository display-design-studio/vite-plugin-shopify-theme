# Release checklist

This checklist is for repository maintainers. It is intentionally excluded from the npm package.

## Release 0.3.0

- [ ] Confirm all eight P1 child issues and implementation PRs are landed and the roadmap links are checked.
- [ ] Confirm `git status --short` is clean and CI plus Compatibility are green on the exact release commit.
- [ ] Run the approval-protected Shopify E2E workflow on `main`; verify CSS/JS delivery, orderly shutdown, and exact snippet restoration.
- [ ] Confirm the `release` environment requires `LucaArgentieri` approval, permits self-approval, and is restricted to `v*` tags.
- [ ] Confirm npm Trusted Publishing targets `display-design-studio/vite-plugin-shopify-theme`, `.github/workflows/release.yml`, and the `release` environment with direct publish permission.
- [ ] Create and push the annotated tag `v0.3.0` from the verified commit.
- [ ] Approve the `release` environment. The workflow verifies the matching version, runs canonical and compatibility suites, publishes through npm OIDC, and creates the GitHub Release.
- [ ] Verify npm provenance, registry integrity, the `latest` dist-tag, 11 published files, root ESM/type exports, and zero runtime dependencies.
- [ ] Rerun the release workflow once and confirm matching registry integrity safely skips publication and reconciles the GitHub Release.

No npm token is stored in GitHub. Publication is exclusively automated through npm Trusted Publishing; credentials must never be placed in chat, files, workflow inputs, or command lines.
