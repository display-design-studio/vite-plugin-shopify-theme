# 2. CLI `init`

```sh
vite-shopify-theme init [directory] \
  [--new | --existing] [--lang js | ts] \
  [--package-manager npm | pnpm | yarn | bun] \
  [--tailwind | --no-tailwind] [--skills | --no-skills] [--yes]
```

`--yes` accepts TypeScript, the detected package manager (npm otherwise), Tailwind, and skills. Explicit negative flags take precedence.

The command installs Vite and the running plugin version as development dependencies. It writes explicit entrypoints, Vite config, package scripts, and narrow ignore patterns. Identical files make reruns safe; incompatible files stop setup before generated configuration is written.

## Shopify AI Toolkit

Setup displays the toolkit telemetry notice and [privacy/opt-out information](https://github.com/Shopify/shopify-ai-toolkit#telemetry) before confirmation. Interactive setup delegates choices to `npx skills add Shopify/shopify-ai-toolkit`; `--yes` lets that CLI auto-detect the project scope and available agents in non-interactive mode. A skills failure leaves Vite setup in place and prints the retry command. Neither tool is added to project dependencies.
