import { outputStyle, paint, type OutputStyle } from '../terminal.js';

export { outputStyle, type OutputStyle };

export interface HeaderInput {
  version: string;
  mode: 'hmr' | 'editor';
  vite: string;
  node: string;
  shopify?: string;
  store?: string;
  environment?: string;
  /** Live-reload mode Shopify CLI runs with; shown in editor mode. */
  liveReload?: string;
}

const row = (style: OutputStyle, label: string, value: string) => `  ${paint(style, 'dim', label.padEnd(9))} ${value}`;

/** Facts the command already knows before anything starts: no probing, no waiting. */
export function formatHeader(input: HeaderInput, style: OutputStyle): string {
  const dot = ` ${paint(style, 'dim', '·')} `;
  const mode = input.mode === 'editor' ? paint(style, 'magenta', paint(style, 'bold', 'editor')) : paint(style, 'cyan', paint(style, 'bold', 'HMR'));
  const versions = [`Vite ${input.vite}`, ...(input.shopify ? [paint(style, 'blue', paint(style, 'bold', `Shopify CLI ${input.shopify}`))] : []), `Node ${input.node.replace(/^v/, '')}`].join(dot);
  const lines = [`${paint(style, 'bold', 'vite-shopify-theme')} ${paint(style, 'dim', input.version)}${dot}${mode}`, row(style, 'versions', versions)];
  if (input.store) lines.push(row(style, 'store', `${input.store}${input.environment ? ` ${paint(style, 'dim', `(environment: ${input.environment})`)}` : ''}`));
  else if (input.environment) lines.push(row(style, 'store', paint(style, 'dim', `(environment: ${input.environment})`)));
  if (input.mode === 'editor') lines.push(row(style, 'assets', `built to assets/${dot}synced by Shopify CLI${dot}live reload: ${input.liveReload ?? 'full-page'}`));
  return `${lines.join('\n')}\n\n`;
}

export interface FooterInput {
  mode: 'hmr' | 'editor';
  /** True when the ownership lock directory is still present after both processes exited. */
  lockRemains: boolean;
  exitCode?: number;
}

export function formatFooter(input: FooterInput, style: OutputStyle): string {
  const stopped = paint(style, 'bold', input.exitCode ? `Stopped (exit code ${input.exitCode}).` : 'Stopped.');
  const detail = input.lockRemains
    ? `A lock remains in .vite-shopify-theme.lock; see "A lock remains after a crash" in the troubleshooting guide.`
    : input.mode === 'editor'
      ? `Generated snippet kept; run ${paint(style, 'bold', 'vite build')} before deploying.`
      : 'Development snippet restored.';
  return `\n${stopped} ${detail}\n`;
}

/** One rule that opens Shopify CLI's output, which is passed through unchanged. */
export function formatShopifyRule(version: string | undefined, style: OutputStyle, width = 72): string {
  const label = `Shopify CLI${version ? ` ${version}` : ''}`;
  const tail = '━'.repeat(Math.max(4, width - label.length - 4));
  return `${paint(style, 'blue', paint(style, 'bold', `━━ ${label} ${tail}`))}\n`;
}

const generatedPatterns = ['.vite-shopify-theme.json', '.vite-shopify-theme.lock', 'assets/vite-manifest.json', 'assets/*-????????.css', 'assets/*-????????.js'];
const wholeAssets = ['assets', 'assets/', '/assets', '/assets/', 'assets/*', '/assets/*'];

/** Generated-file patterns that `init` writes and a watch session needs in `.gitignore`; Tailwind watches every unignored file. */
export function missingGeneratedPatterns(gitignore: string | undefined): string[] {
  const lines = new Set((gitignore ?? '').split(/\r?\n/).map((line) => line.trim()));
  const ignoresAssets = wholeAssets.some((line) => lines.has(line));
  return generatedPatterns.filter((pattern) => !lines.has(pattern) && !(ignoresAssets && pattern.startsWith('assets/')));
}

export const troubleshootingUrl = 'https://display-design-studio.github.io/vite-plugin-shopify-theme/troubleshooting#dev-editor-or-vite-build-watch-rebuilds-again-and-again';

export function formatGitignoreHint(missing: string[], style: OutputStyle): string {
  if (!missing.length) return '';
  return `  ${paint(style, 'yellow', 'hint')}  .gitignore lacks ${missing.length === 1 ? 'a generated-file pattern' : `${missing.length} generated-file patterns`}; Tailwind CSS then rebuilds in a loop. The patterns are listed here:\n        ${paint(style, 'dim', troubleshootingUrl)}\n\n`;
}
