# Performance patterns

Performance starts with loading less code on each page, while keeping ownership and loading decisions easy to trace.

## Keep the global entry small

The global entry should initialize only behavior used across most of the storefront. Product galleries, collection filters, and account forms belong in [page-specific entries](./page-specific-entrypoints) or lazy modules.

## Gate dynamic imports with the DOM

A loaded entry can defer an optional feature until its markup exists:

```ts
const gallery = document.querySelector<HTMLElement>('[data-product-gallery]');

if (gallery) {
  void import('../features/product-gallery').then(({ mountGallery }) => {
    mountGallery(gallery);
  });
}
```

The imported file is an internal Vite chunk, not a Liquid-facing entry. Do not add it to `entries` unless Liquid must load it directly.

## Keep critical CSS independent

Inline or serve the minimum styles needed for first paint separately from the main stylesheet. The [Display Skeleton Theme's `critical.css`](https://github.com/display-design-studio/skeleton-theme/blob/main/assets/critical.css) demonstrates this separation. Because it is a manual theme asset, leave it outside plugin ownership unless you deliberately migrate it to an explicit Vite entry.

## Put section-local code near its trigger

For a section that may appear on several page types, use a small global or page entry to detect a stable `data-*` hook and dynamically import the implementation. Shopify can render a section more than once, so initialize every matching element and make initialization idempotent:

```ts
const recommendations = document.querySelectorAll<HTMLElement>(
  '[data-product-recommendations]',
);

if (recommendations.length > 0) {
  void import('../features/product-recommendations').then(({ mount }) => {
    recommendations.forEach((element) => mount(element));
  });
}
```

Prefer stable markup contracts over assumptions about a section's position. The Skeleton Theme's [section structure](https://github.com/display-design-studio/skeleton-theme/tree/main/sections) offers useful examples of keeping theme components locally understandable.
