# 1. Getting Started

## Create a theme

1. Run `npx @display-studio/vite-plugin-shopify-theme init my-theme`.
2. Review the wizard summary. TypeScript, npm (or a detected manager), and Tailwind are selected by default.
3. Run `cd my-theme && npm run dev`.

When the target does not exist, setup clones Shopify's Skeleton `v1.0.0` release without its git history.

## Configure an existing theme

1. Enter a theme root containing `assets`, `layout`, and `snippets`.
2. Run `npx @display-studio/vite-plugin-shopify-theme init`.
3. Run the generated `dev` script.

Setup refuses incompatible manual files and never converts an invalid directory. If the layout cannot be patched unambiguously, it is preserved and exact instructions are printed.
