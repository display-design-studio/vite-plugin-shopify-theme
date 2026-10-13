# Critical CSS

Goal: render the styles needed for first paint inline, so they do not block rendering and cost no request, while the rest of the CSS loads normally.

Shopify's `inline_asset_content` filter inlines an asset only when it is SVG, JS, or CSS and smaller than 15 KB ([reference](https://shopify.dev/docs/api/liquid/filters/inline_asset_content)). That fits a small critical stylesheet, not a full bundle.

## Steps

1. Put only above-the-fold rules (layout shell, header, typography, tokens) in a small stylesheet.
2. Declare it as an inline entry next to the main stylesheet:

   ```ts
   // vite.config.ts
   shopify({
     entries: {
       'critical.css': { source: 'frontend/entrypoints/critical.css', inline: true },
       'theme.css': 'frontend/entrypoints/theme.css',
       'theme.ts': 'frontend/entrypoints/theme.ts',
     },
   });
   ```

3. Render both in `<head>`, critical first:

   ```liquid
   {% render 'vite-tag', entry: 'critical.css' %}
   {% render 'vite-tag', entry: 'theme.css' %}
   ```

4. Run `npm run build` and open `snippets/vite-tag.liquid`: the `critical.css` block contains a `<style>` with `inline_asset_content`, and `theme.css` a normal `<link>`.

## Behavior to know

- The built file stays in `assets` and is recorded as plugin-owned; the filter reads it from the theme at render time.
- In development the entry is a normal Vite `<link>` with HMR, so you see the same styles without inlining.
- At 15,000 bytes or more the build warns with `INLINE_CSS_TOO_LARGE` and renders a `<link>` instead. Shrink the stylesheet or remove `inline`.
- With `build.cssCodeSplit: false`, all stylesheets merge into one aggregated file and `inline` is ignored.
- The rendered page grows by the size of the inlined CSS; the snippet itself stays tiny, so the 256 kB snippet limit is unaffected.
