# 2. CLI `init`

```sh
vite-shopify-theme init [directory] \
  [--new | --existing] [--lang js | ts] \
  [--package-manager npm | pnpm | yarn | bun] \
  [--tailwind | --no-tailwind] [--yes]
```

`--yes` accepts TypeScript, the detected package manager (npm otherwise), and Tailwind. Explicit negative flags take precedence.

The command installs Vite and the running plugin version as development dependencies. It writes explicit entrypoints, Vite config, package scripts (`build`, `dev`, and `dev:editor` when it is not already defined), and narrow ignore patterns. It also creates a placeholder `snippets/vite-tag.liquid` when none exists, so the theme renders before the first `dev` or build; both replace it and an existing snippet is never overwritten. It also writes `example.shopify.theme.toml`, a template for the Shopify CLI `development` environment that `dev` selects automatically, and adds `shopify.theme.toml` to `.gitignore`. An existing example file is kept. Identical files make reruns safe; incompatible files stop setup before generated configuration is written.

## Shopify AI Toolkit

`init` does not install Shopify AI Toolkit skills. See the [cookbook](/cookbook/developer-experience#shopify-ai-toolkit-skills) to add them. The deprecated `--no-skills` flag is accepted and ignored; `--skills` was removed.

## New themes and git

A new theme is cloned from Shopify's Skeleton `v1.0.0` release. The clone's git history is removed, so the project starts without a repository; run `git init` when you want one. An existing theme's repository is never touched.
