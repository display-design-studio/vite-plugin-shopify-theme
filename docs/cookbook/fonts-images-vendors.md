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

## Static files: `assets/`, not `public/`

Vite's `public/` directory is turned off: the plugin sets `publicDir: false`, and setting it yourself fails with `CONFIG_VITE_CONFLICT`. A `public/` folder is ignored. Choose by whether you want a content hash.

| You want | Do this | Result |
| --- | --- | --- |
| A hashed file the plugin manages | Keep it in `frontend/` and reference it from CSS (`url('../images/icon.svg')`) or import it from JavaScript | Emitted to `assets/` with a content hash and recorded as plugin-owned, so it is cleaned up when it is no longer used |
| A stable file name | Put the file in the theme's `assets/` folder yourself | Never touched or deleted by the plugin; no hash |

Files under `build.assetsInlineLimit` (4 KiB by default) are inlined as data URIs instead of emitted, so a small icon may not appear in `assets/`. Set the limit to `0` to always emit files.

Using a manual file from Liquid is the usual Shopify way: `{{ 'icon.svg' | asset_url }}`. Using one from CSS works with a relative URL that names the file as if it sat next to the built stylesheet. Vite cannot find the file in your source, so it prints `didn't resolve at build time, it will remain unchanged` and keeps the URL. The built stylesheet is served from the same `assets/` folder as your file, so the browser resolves it correctly. This is expected.

Vite rebases a relative URL from the CSS file that contains it to the entry stylesheet. In a partial in a subfolder, write the path from the partial to the entry's folder:

```css
/* frontend/entrypoints/main.css, same folder as the entry */
.icon { background-image: url('icon.svg'); }

/* frontend/entrypoints/css/components.css, imported by main.css */
.icon { background-image: url('../icon.svg'); }
```

Check the built stylesheet when you are unsure: the URL must name only the file, as `url(icon.svg)` or `url(./icon.svg)`. `url(./css/icon.svg)` points to `assets/css/icon.svg`, which does not exist, so the file fails to load in the browser. Forms to avoid:

- `url('icon.svg')` inside a subfolder partial: it becomes `./css/icon.svg`, as above.
- `url('/icon.svg')` is left as an absolute path on your store domain, which does not exist.
- `url('/assets/icon.svg')` and `url('../../assets/icon.svg')` make Vite find the file in the project's `assets/` folder and copy it to a hashed name, leaving a duplicate in `assets/`. Small files are inlined instead.

A manual file has no content hash, so Shopify's own asset caching decides when a changed file is picked up. Rename the file when its contents must change immediately.

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
