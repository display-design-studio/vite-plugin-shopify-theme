export interface OutputStyle { color: boolean }

/** Colors only on an interactive terminal; `NO_COLOR`, `CI`, a dumb terminal, or piped output get plain text. */
export function outputStyle(env: NodeJS.ProcessEnv, isTTY: boolean): OutputStyle {
  return { color: isTTY && !env.NO_COLOR && !env.CI && env.TERM !== 'dumb' };
}

const codes = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, magenta: 35, cyan: 36, blue: 94 } as const;
type Paint = keyof typeof codes;

function paint(style: OutputStyle, name: Paint, text: string) {
  return style.color ? `\x1b[${codes[name]}m${text}\x1b[0m` : text;
}

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
