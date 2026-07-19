export type { TerminalSession, TerminalSessionOptions } from './terminal-session.ts'
export { createTerminalSession } from './terminal-session.ts'
export { TerminalPanel } from './terminal-panel.tsx'
export type { TerminalPanelProps } from './terminal-panel.tsx'
export {
  TERMINAL_COLORS_DARK,
  TERMINAL_COLORS_HIGH_CONTRAST,
  TERMINAL_COLORS_LIGHT,
  resolveTerminalColors,
  terminalColorsToStyle,
} from './terminal-colors.ts'
export type { TerminalColors } from './terminal-colors.ts'
export { askTerminalAgent } from './terminal-agent.ts'
export { runTerminalPrivilege } from './terminal-privilege.ts'
export type {
  TerminalPrivilegeKind,
  TerminalPrivilegeRequest,
  TerminalPrivilegeResult,
} from './terminal-privilege-types.ts'
export type {
  TerminalHandle,
  TerminalLine,
  TerminalSessionSnapshot,
  TerminalSubmitOptions,
  TerminalUpsertBlockOptions,
} from './terminal-types.ts'
