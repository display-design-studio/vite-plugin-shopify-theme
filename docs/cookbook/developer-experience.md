# Developer experience

[`@display-studio/vite-plugin-shopify-devtools`](https://github.com/display-design-studio/vite-plugin-shopify-devtools) is an optional companion that adds a **Shopify Liquid** panel to the official Vite DevTools dock. It can inspect rendered sections, blocks, and snippets, then open their source in your editor.

## Install

Vite 8.3 or newer must be a direct dependency of the theme project:

```sh
npm install -D vite@^8.3 @display-studio/vite-plugin-shopify-devtools
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import shopifyTheme from '@display-studio/vite-plugin-shopify-theme';
import shopifyDevtools, {
  shopifyDevtoolsConfig,
} from '@display-studio/vite-plugin-shopify-devtools';

export default defineConfig({
  devtools: shopifyDevtoolsConfig,
  plugins: [
    shopifyTheme({
      entries: {
        'theme.ts': 'frontend/entrypoints/theme.ts',
      },
    }),
    shopifyDevtools(),
  ],
});
```

Continue to run `vite-shopify-theme dev` as usual. In its default mode, DevTools runs during `vite serve`, leaves production builds and source Liquid unchanged, and infers blocks and static snippets from the rendered page. It needs at least one loaded JavaScript or TypeScript entry so its browser client can run.

::: info Separate compatibility boundary
The core theme plugin supports the wider Vite 8 range. Only the optional DevTools companion requires Vite 8.3+. Its own dependencies are consumer development tools and do not change this package's zero-runtime-dependency guarantee.
:::

## Exact component nesting

Try the default mode first. When exact block and snippet nesting matters, use the safe copy mode:

```ts
shopifyDevtools({ instrument: 'copy' })
```

Copy mode maintains an ignored, instrumented theme mirror without rewriting source files. It requires pointing Shopify CLI at that mirror; follow the companion repository's [full setup instructions](https://github.com/display-design-studio/vite-plugin-shopify-devtools#full-mode). The in-place mode and compatibility wrapper exist for specialized workflows, but they should not replace this plugin's normal development command by default.

## Keep the connection private

Retain Vite DevTools client authentication. The first connection may ask you to authorize the browser with a one-time code. Never commit, log, or share authentication tokens. Setting `clientAuth: false` exposes DevTools server and filesystem capabilities to any browser that can reach Vite, so avoid it outside a fully trusted local environment.

## Shopify AI Toolkit skills

[Shopify AI Toolkit](https://github.com/Shopify/shopify-ai-toolkit) skills give coding agents Shopify-specific guidance. Install them from the theme root when you want them:

```sh
npx skills add Shopify/shopify-ai-toolkit
```

The toolkit has telemetry enabled by default; read the [privacy and opt-out information](https://github.com/Shopify/shopify-ai-toolkit#telemetry) first. The skills CLI lets you choose the project scope and agents, and nothing is added to your project dependencies.
