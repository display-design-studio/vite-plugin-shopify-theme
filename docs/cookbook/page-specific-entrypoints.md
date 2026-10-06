# Page-specific entrypoints

Declare every Liquid-facing entry in `vite.config.ts`, then choose among those names in Liquid. Entry keys are flat asset names: `product.ts` is valid, while `ts/product.ts` is intentionally invalid.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import shopifyTheme from '@display-studio/vite-plugin-shopify-theme';

export default defineConfig({
  plugins: [
    shopifyTheme({
      entries: {
        'theme.css': 'frontend/entrypoints/theme.css',
        'theme.ts': 'frontend/entrypoints/theme.ts',
        'product.ts': 'frontend/entrypoints/product.ts',
        'collection.ts': 'frontend/entrypoints/collection.ts',
      },
    }),
  ],
});
```

Render the development client and global entries once in `layout/theme.liquid`:

```liquid
{% render 'vite-tag' %}
{% render 'vite-tag', entry: 'theme.css' %}
{% render 'vite-tag', entry: 'theme.ts' %}
```

Then select the page bundle. This can live in the layout near the closing `body` tag:

```liquid
{% case request.page_type %}
  {% when 'product' %}
    {% render 'vite-tag', entry: 'product.ts' %}
  {% when 'collection' %}
    {% render 'vite-tag', entry: 'collection.ts' %}
{% endcase %}
```

The no-entry render is needed only once: during development it emits the virtual reload client. Each named render resolves to the Vite development URL or the matching production manifest asset.

Modules reached through a dynamic `import()` do **not** belong in `entries`. Vite discovers and chunks those internal dependencies from their parent entry:

```ts
// frontend/entrypoints/product.ts
if (document.querySelector('[data-product-gallery]')) {
  void import('../features/product-gallery');
}
```

This pattern follows the same page-aware principle visible in the [Display Skeleton Theme's layout](https://github.com/display-design-studio/skeleton-theme/blob/main/layout/theme.liquid), adapted to this plugin's explicit, flat entry names.
