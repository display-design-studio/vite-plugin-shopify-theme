# Manual release checklist

This checklist is for repository maintainers. It is intentionally excluded from the npm package.

## Release 0.2.0

- [ ] Check out the release commit and confirm `git status --short` is empty.
- [ ] Run `npm ci`.
- [ ] Run the canonical suite with `npm run check`.
- [ ] Run the network-dependent compatibility matrix with `npm run compat`.
- [ ] Run `npm publish --dry-run` and verify version `0.2.0`, the expected file list, package metadata, and links. Confirm there is no CLI, runtime dependency, or unexpected subpath.
- [ ] Confirm `git diff --check` passes and `package.json` agrees with `package-lock.json`.
- [ ] Create and push the annotated tag `v0.2.0` from the verified commit.
- [ ] Publish to the public npm registry with `npm publish`.
- [ ] Verify the registry page, metadata, provenance, installability, and root ESM/type exports.

Tagging and publication are deliberate maintainer actions and are not performed by CI.
