# Fonts, images, and vendor code

All build output lands flat in the theme `assets` directory with hashed names, and every generated file is recorded in `.vite-shopify-theme.json`. Never place hand-written files next to generated ones under the same name pattern; manual assets are left alone.

## Fonts and images referenced from CSS

Reference them with a relative path or alias inside the stylesheet. Vite emits the files to `assets` and rewrites the URL relative to the built stylesheet, so no Liquid `asset_url` is needed.

```css
/* frontend/entrypoints/theme.css */
@font-face {
  font-family: 'Inter';
  src: url('../fonts/inter.woff2') format('woff2');
  font-display: swap;
}
.hero { background-image: url('../images/hero.svg'); }
```

Small files can be inlined by Vite (`build.assetsInlineLimit`). Set it to `0` to always emit files. Source maps (`build.sourcemap`) are emitted as `.map` files in `assets` and recorded as plugin-owned.

## Images used in Liquid

Keep Shopify-managed images in the theme as usual (`assets` files you add manually or `image_url` for uploaded media). Only import images from JavaScript or CSS when the bundle needs them.

## Vendor packages from node_modules

Import them from an entry or from a module the entry imports. Vite bundles and hashes them.

```ts
// frontend/entrypoints/theme.ts
import 'swiper/css';
import Swiper from 'swiper';
```

- Shared vendor code that several entries import is split into a shared chunk automatically.
- Load optional vendor code lazily with `import('swiper')` from a loaded entry (see [Performance patterns](./performance-patterns)). Dynamic chunks are built and recorded, but are not preloaded by the snippet.
- Do not add a vendor entry per package unless Liquid renders it explicitly. Every entry is public Liquid API.

## Tailwind

See [Tailwind & Frameworks](../tailwind-frameworks). The `init` wizard wires `@tailwindcss/vite` and `@import "tailwindcss"` for you.
