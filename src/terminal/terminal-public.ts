/**
 * 模拟终端公共导出桶文件。
 *
 * 本文件中标有 @deprecated 的导出为模拟终端 agent 会话路径，已被真终端取代。
 * 未标弃用的导出（配色、特权、类型）为共享基础设施，正常使用。
 */

// ---- 以下为模拟终端会话路径，已弃用 ----

/** @deprecated 随模拟终端弃用，生成应用（generated-app-terminal-host）仍复用，迁移前勿删 */
export type { TerminalSession, TerminalSessionOptions } from './terminal-session.ts'
/** @deprecated 随模拟终端弃用，生成应用（generated-app-terminal-host）仍复用，迁移前勿删 */
export { createTerminalSession } from './terminal-session.ts'
/** @deprecated 随模拟终端弃用 */
export { TerminalPanel } from './terminal-panel.tsx'
/** @deprecated 随模拟终端弃用 */
export type { TerminalPanelProps } from './terminal-panel.tsx'

// ---- 以下为共享基础设施，正常使用 ----

export {
  TERMINAL_COLORS_DARK,
  TERMINAL_COLORS_HIGH_CONTRAST,
  TERMINAL_COLORS_LIGHT,
  resolveTerminalColors,
  terminalColorsToStyle,
} from './terminal-colors.ts'
export type { TerminalColors } from './terminal-colors.ts'
/** @deprecated 随模拟终端弃用 */
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
