# Quality tooling

Keep checks in the theme project so their versions, rules, and exclusions reflect that theme. None of these tools is required by the plugin.

## Liquid and theme files

[Shopify Theme Check](https://github.com/Shopify/theme-tools) catches Liquid syntax errors, missing translations, invalid schema, and common theme problems. Run it from the theme root:

```sh
shopify theme check
```

Commit a `.theme-check.yml` only when the project needs settings beyond the standard checks. The [Skeleton Theme configuration](https://github.com/display-design-studio/skeleton-theme/blob/main/.theme-check.yml) is a useful starting point, but review every rule for your own theme.

## JavaScript and TypeScript

Install and configure ESLint in the consuming theme, then combine it with TypeScript's type-only check:

```json
{
  "scripts": {
    "lint": "eslint frontend",
    "typecheck": "tsc --noEmit",
    "check": "npm run lint && npm run typecheck && shopify theme check"
  }
}
```

`tsc --noEmit` verifies types without competing with Vite for build output. Keep generated `assets/` and the generated `vite-tag.liquid` snippet out of lint targets: validate source files, not plugin-owned output.

::: warning Preserve generated boundaries
Do not use formatter or cleanup commands that sweep the complete Shopify `assets/` directory. This plugin removes only flat generated assets recorded in its ownership state; manual theme assets must remain untouched.
:::
