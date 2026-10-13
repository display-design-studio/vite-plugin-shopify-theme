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

## Page-specific stylesheets

Split CSS the same way. A stylesheet is an entry like any script, so declare one per template family next to the script that needs it:

```ts
// vite.config.ts
shopifyTheme({
  entries: {
    'theme.css': 'frontend/entrypoints/theme.css',
    'theme.ts': 'frontend/entrypoints/theme.ts',
    'product.css': 'frontend/entrypoints/product.css',
    'product.ts': 'frontend/entrypoints/product.ts',
    'collection.css': 'frontend/entrypoints/collection.css',
    'collection.ts': 'frontend/entrypoints/collection.ts',
  },
});
```

Render stylesheets in `<head>`, so the page does not paint unstyled, and scripts before `</body>`:

```liquid
{%- comment -%} layout/theme.liquid, inside <head> {%- endcomment -%}
{% render 'vite-tag' %}
{% render 'vite-tag', entry: 'theme.css' %}
{% case request.page_type %}
  {% when 'product' %}
    {% render 'vite-tag', entry: 'product.css' %}
  {% when 'collection' %}
    {% render 'vite-tag', entry: 'collection.css' %}
{% endcase %}
```

```liquid
{%- comment -%} layout/theme.liquid, before </body> {%- endcomment -%}
{% render 'vite-tag', entry: 'theme.ts' %}
{% case request.page_type %}
  {% when 'product' %}
    {% render 'vite-tag', entry: 'product.ts' %}
  {% when 'collection' %}
    {% render 'vite-tag', entry: 'collection.ts' %}
{% endcase %}
```

Guidelines:

- Keep the global stylesheet to what every page needs: reset, tokens, layout, header, footer. Put template-only rules in the page stylesheet.
- Prefer a separate CSS entry over `import './product.css'` inside `product.ts`. A stylesheet imported from a script is still linked by the generated snippet, but it is emitted where that script is rendered (usually the end of `body`), which can flash unstyled content.
- Leave `build.cssCodeSplit` at its default. Setting it to `false` merges every stylesheet into one aggregated `style.css`, which undoes the split.
- With Tailwind v4, a page stylesheet that uses `@apply` or theme tokens needs `@reference "./theme.css";` at the top (adjust the path), because each entry is compiled on its own. Put `@import "tailwindcss";` only in the global stylesheet.
- Section-only styles can follow the same rule: one named entry, rendered by the section that needs it.

Modules reached through a dynamic `import()` do **not** belong in `entries`. Vite discovers and chunks those internal dependencies from their parent entry:

```ts
// frontend/entrypoints/product.ts
if (document.querySelector('[data-product-gallery]')) {
  void import('../features/product-gallery');
}
```

This pattern follows the same page-aware principle visible in the [Display Skeleton Theme's layout](https://github.com/display-design-studio/skeleton-theme/blob/main/layout/theme.liquid), adapted to this plugin's explicit, flat entry names.
