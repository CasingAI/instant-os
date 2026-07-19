/** 终端面板语义色；宿主可传入完整或局部覆盖，未给的键回落到默认深色 */
export type TerminalColors = {
  bg: string
  fg: string
  muted: string
  error: string
  program: string
  status: string
}

export const TERMINAL_COLORS_DARK: TerminalColors = {
  bg: '#1c1c1e',
  fg: '#e8e8ed',
  muted: '#8e8e93',
  error: '#ff6b6b',
  program: '#7ec8e3',
  status: '#aeaeb2',
}

/** 浅色宿主（如 VS Code Light）下的终端配色 */
export const TERMINAL_COLORS_LIGHT: TerminalColors = {
  bg: '#ffffff',
  fg: '#1e1e1e',
  muted: '#6e6e6e',
  error: '#c72e0f',
  program: '#0451a5',
  status: '#6e6e6e',
}

/** 高对比深色 */
export const TERMINAL_COLORS_HIGH_CONTRAST: TerminalColors = {
  bg: '#000000',
  fg: '#ffffff',
  muted: '#ffffff',
  error: '#ff0000',
  program: '#00ffff',
  status: '#ffffff',
}

export function resolveTerminalColors(
  colors?: Partial<TerminalColors>,
): TerminalColors {
  if (!colors) return TERMINAL_COLORS_DARK
  return {
    bg: colors.bg ?? TERMINAL_COLORS_DARK.bg,
    fg: colors.fg ?? TERMINAL_COLORS_DARK.fg,
    muted: colors.muted ?? TERMINAL_COLORS_DARK.muted,
    error: colors.error ?? TERMINAL_COLORS_DARK.error,
    program: colors.program ?? TERMINAL_COLORS_DARK.program,
    status: colors.status ?? TERMINAL_COLORS_DARK.status,
  }
}

/** 写入 `.terminal-panel` 根节点的 CSS 变量 */
export function terminalColorsToStyle(
  colors?: Partial<TerminalColors>,
): Record<string, string> {
  const resolved = resolveTerminalColors(colors)
  return {
    '--terminal-bg': resolved.bg,
    '--terminal-fg': resolved.fg,
    '--terminal-muted': resolved.muted,
    '--terminal-error': resolved.error,
    '--terminal-program': resolved.program,
    '--terminal-status': resolved.status,
  }
}
