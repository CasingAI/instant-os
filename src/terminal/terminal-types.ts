import type { TerminalPrivilegeRequest } from './terminal-privilege-types.ts'

export type TerminalLineSource = 'user' | 'program'

export type TerminalLineKind = 'input' | 'output' | 'status' | 'error'

export type TerminalLineFormat = 'plain' | 'markdown'

export type TerminalLine = {
  id: string
  kind: TerminalLineKind
  text: string
  /** 仅 input 行：手动输入 vs 程序下发 */
  source?: TerminalLineSource
  streaming?: boolean
  /** 默认 plain；markdown 时由面板渲染 GFM */
  format?: TerminalLineFormat
  /**
   * 可替换块标识。同 key 再次写入会原地更新该行，而不是追加。
   * 用于进度条、动态表格等 Live Markdown。
   */
  blockKey?: string
}

export type TerminalUpsertBlockOptions = {
  key: string
  text: string
  format?: TerminalLineFormat
  kind?: Exclude<TerminalLineKind, 'input'>
  streaming?: boolean
}

export type TerminalSessionSnapshot = {
  cwd: string
  lines: TerminalLine[]
  busy: boolean
}

export type TerminalSessionListener = (snapshot: TerminalSessionSnapshot) => void

export type TerminalSubmitOptions = {
  source?: TerminalLineSource
  thinkingEnabled?: boolean
}

export type TerminalHandle = {
  exec: (line: string) => Promise<void>
  runPrivilege: (request: TerminalPrivilegeRequest) => Promise<void>
  write: (text: string) => void
  upsertBlock: (options: TerminalUpsertBlockOptions) => void
  removeBlock: (key: string) => void
  clear: () => void
  abort: () => void
  getCwd: () => string
  getEnv: () => Record<string, string>
  cd: (path: string) => Promise<void>
  getSnapshot: () => TerminalSessionSnapshot
}
