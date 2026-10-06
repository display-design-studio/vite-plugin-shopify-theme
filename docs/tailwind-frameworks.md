# 5. Tailwind and Frameworks

Default setup installs `tailwindcss` and `@tailwindcss/vite`, adds `tailwindcss()` before the Shopify plugin, and imports Tailwind from `theme.css`. Use `--no-tailwind` for plain CSS.

Vue and React remain ordinary Vite plugins. Add their official plugin and map every storefront entry explicitly. The repository includes runnable Vue and React examples.

For React, include the React refresh preamble explicitly before a development entry that needs Fast Refresh; Shopify's Liquid page is not transformed from an HTML entry by Vite. Vue entrypoints work through the official Vue plugin in the usual way. In both cases, mount into elements emitted by Liquid and keep every independently rendered bundle in the plugin's `entries` map.

Framework compatibility is verified separately from the canonical check because those fixtures install packages from the network. Run `npm run compat:vue`, `npm run compat:react`, or `npm run compat:frameworks` when changing framework-facing behavior.
