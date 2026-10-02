# Release checklist

This checklist is for repository maintainers. It is intentionally excluded from the npm package.

## Release 0.2.1

- [ ] Check out the release commit and confirm `git status --short` is empty.
- [ ] Run `npm ci`.
- [ ] Run `npm ci --prefix playground/skeleton-theme`.
- [ ] Run the canonical suite with `npm run check`.
- [ ] Run the network-dependent compatibility matrices with `npm run compat` and `npm run compat:frameworks`.
- [ ] Run `npm publish --dry-run --access public` and verify package `@display-studio/vite-plugin-shopify-theme`, version `0.2.1`, 11 published files, the expected organization metadata, and links. Confirm there is no CLI, runtime dependency, or unexpected subpath.
- [ ] Confirm `git diff --check` passes and `package.json` agrees with `package-lock.json`.
- [ ] Confirm the repository is public and CI plus Compatibility are green on the exact release commit.
- [ ] Run `npm run e2e:shopify` against the test store and verify development assets, CSS/JS loading, and exact snippet restoration.
- [ ] Create and push the annotated tag `v0.2.1` from the verified commit. The release workflow requires the tag and `package.json` version to match, verifies the release and compatibility matrices, then waits for approval of the `release` environment.
- [ ] From a clean checkout of the tagged commit, run `npm whoami`, then publish locally with `npm publish --access public`. Enter the six-digit 2FA code only at npm's interactive prompt; never put it in chat, a file, or the command line.
- [ ] Verify `@display-studio/vite-plugin-shopify-theme@0.2.1` on the registry: dist-tag `latest`, 11 files, MIT license, repository metadata, root ESM and type exports, and no runtime dependencies or CLI.
- [ ] Install the published package in a clean temporary directory and verify the root import and TypeScript declarations.
- [ ] Approve the GitHub `release` environment so the workflow creates the GitHub Release.

Tagging and local npm publication remain deliberate maintainer actions. The workflow never receives an npm token and does not publish to npm or generate provenance; after verification, environment approval only authorizes creation of the GitHub Release.
