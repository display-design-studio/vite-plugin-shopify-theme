import { normalizeOptions as normalize } from './config.js';
import type { NormalizedOptions as Normalized } from './config.js';
import {
  collectManifestTags as collect,
  developmentSnippet as development,
  productionSnippet as production,
} from './snippets.js';
import type { ManifestTags as Tags } from './snippets.js';

export { default, shopifyTheme } from './plugin.js';
export type { EntryOptions, ShopifyThemeOptions } from './config.js';

// Internal helpers that were exported by accident. They are deprecated in 0.7.0 and removed in 1.0.0 (RFC 0004).
// They are re-declared here, rather than tagged where they are defined, so the plugin's own use of them is not flagged.
/** @deprecated Internal; removed in 1.0.0. */
export const normalizeOptions = normalize;
/** @deprecated Internal; removed in 1.0.0. */
export type NormalizedOptions = Normalized;
/** @deprecated Internal; removed in 1.0.0. */
export const collectManifestTags = collect;
/** @deprecated Internal; removed in 1.0.0. */
export type ManifestTags = Tags;
/** @deprecated Internal; removed in 1.0.0. */
export const developmentSnippet = development;
/** @deprecated Internal and out of date (it cannot render `attributes`, `inline`, or the CSS bundle); removed in 1.0.0. */
export const productionSnippet = production;
