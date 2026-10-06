# Cookbook

Use the smallest loading strategy that matches where code is needed. This keeps the theme predictable in Liquid and gives Vite clear, explicit build boundaries.

| Strategy | Use it for | Where to load it |
| --- | --- | --- |
| Global entry | Navigation, cart UI, analytics bootstrap, and code needed on nearly every page | Render once from the layout |
| Page-specific entry | Product galleries, collection filters, or account pages with a clear Shopify page type | Select an explicit entry in Liquid |
| Lazy-loaded module | An optional interaction that can be detected in the DOM | Dynamically import it from a loaded entry |

Start with one small global entry. Add a [page-specific entrypoint](./page-specific-entrypoints) when an entire template family needs substantial code, and use the [performance patterns](./performance-patterns) for optional features within those pages.

These recipes take inspiration from the [Display Skeleton Theme](https://github.com/display-design-studio/skeleton-theme), particularly its separation of critical styles and theme structure. They adapt those ideas to this plugin's explicit entries and ownership rules rather than copying another Vite configuration.

For the underlying platforms, keep the [Shopify theme architecture guide](https://shopify.dev/docs/storefronts/themes/architecture) and [Vite guide](https://vite.dev/guide/) close at hand.

## Recipes

- [Page-specific entrypoints](./page-specific-entrypoints): connect `request.page_type` to flat, declared entry names.
- [Developer experience](./developer-experience): inspect rendered Liquid with the optional DevTools companion.
- [Quality tooling](./quality-tooling): check Liquid, TypeScript, and JavaScript in the project that owns them.
- [Performance patterns](./performance-patterns): keep global work small and defer optional behavior.

::: tip Keep the boundary visible
Entries are public names used by Liquid. Internal modules are implementation details imported by those entries.
:::
