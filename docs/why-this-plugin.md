# Why this plugin?

Shopify theme tooling has two useful design points. Convention-driven tools discover entrypoints and automate more of the development environment. This plugin instead asks you to name every storefront entry and keeps infrastructure such as tunnels and deployment outside its contract.

That explicitness is deliberate. The same entry map drives Vite input, the generated manifest, and Liquid branches, so a configuration change is reviewable and output stays deterministic. There is no glob whose result can change when an unrelated source file is added.

The other distinction is cleanup. A theme's `assets` and `snippets` directories often contain files written by people, Shopify, apps, and other build systems. This plugin records only the flat files it generated and removes only obsolete files in that ownership record. It does not infer ownership from a filename pattern. Atomic writes, a theme-root lock, and hash-checked crash recovery protect manual files when builds overlap or stop unexpectedly.

Choose this plugin when production predictability, an auditable entry map, zero runtime dependencies, and conservative file ownership matter more than automatic discovery or a built-in tunnel. Choose a convention-driven integration when its broader automation is the better trade-off for your team.

The scope is intentionally narrow: Vite 8, explicit entries, generated Liquid, safe lifecycle handling, setup, and coordinated local development. Tunnel provisioning and deployment remain the responsibility of dedicated tools.
