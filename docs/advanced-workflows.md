# 6. Advanced Workflows

`vite build` writes flat hashed files and a manifest to `assets`, renders deterministic Liquid, then records owned files. Later builds remove only obsolete recorded files; manual assets are never inferred.

Manifest traversal is deterministic, iterative, and cycle-safe. Imported styles appear before scripts and shared JavaScript is preloaded unless `build.modulePreload` is false.

The theme-root lock prevents concurrent writers. Stale recovery restores a previous snippet only when its generated hash still matches. Tunnel creation and deployment are outside the CLI contract.
