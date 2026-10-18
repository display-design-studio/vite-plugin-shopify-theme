export interface OutputStyle { color: boolean }

/** Colors only on an interactive terminal; `NO_COLOR`, `CI`, a dumb terminal, or piped output get plain text. */
export function outputStyle(env: NodeJS.ProcessEnv, isTTY: boolean): OutputStyle {
  return { color: isTTY && !env.NO_COLOR && !env.CI && env.TERM !== 'dumb' };
}

const codes = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, magenta: 35, cyan: 36, blue: 94 } as const;
export type Paint = keyof typeof codes;

export function paint(style: OutputStyle, name: Paint, text: string) {
  return style.color ? `\x1b[${codes[name]}m${text}\x1b[0m` : text;
}

export type BuildReport = { ok: true; entries: number; ms: number; snippet: 'written' | 'unchanged' } | { ok: false };

/** One line per watch-mode build, from numbers the plugin already has. */
export function formatBuildLine(report: BuildReport, style: OutputStyle): string {
  const prefix = paint(style, 'dim', '[shopify-theme]');
  const dot = ` ${paint(style, 'dim', '·')} `;
  if (!report.ok) return `${prefix} build ${paint(style, 'red', 'failed')}${dot}keeping the last good output`;
  return `${prefix} build ${paint(style, 'green', 'ok')}${dot}${report.entries} ${report.entries === 1 ? 'entry' : 'entries'}${dot}${Math.round(report.ms)} ms${dot}snippet ${report.snippet}`;
}
