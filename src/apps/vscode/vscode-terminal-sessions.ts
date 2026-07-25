import type { TerminalFsMode } from '../../terminal/terminal-fs-mode.ts'
import { osNowMs } from '../../os/os-clock.ts'

export type VscodeTerminalSessionKind = 'user' | 'agent'

export type VscodeTerminalSession = {
  id: string
  title: string
  kind: VscodeTerminalSessionKind
  /** agent 会话绑定的 AI chat sessionId */
  ownerChatId?: string
  fsMode: TerminalFsMode
}

export function createVscodeTerminalSessionId(): string {
  return `vsterm-${osNowMs()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createUserTerminalSession(
  fsMode: TerminalFsMode = 'controlled',
  index = 1,
): VscodeTerminalSession {
  return {
    id: createVscodeTerminalSessionId(),
    title: index <= 1 ? '终端' : `终端 ${index}`,
    kind: 'user',
    fsMode,
  }
}

export function createAgentTerminalSession(
  ownerChatId: string,
  chatTitle: string,
): VscodeTerminalSession {
  const short = chatTitle.trim() || '对话'
  return {
    id: createVscodeTerminalSessionId(),
    title: `Agent · ${short.slice(0, 24)}`,
    kind: 'agent',
    ownerChatId,
    fsMode: 'controlled',
  }
}

export type VscodeAgentTerminalEnsureReason = 'reused' | 'new' | 'rebuilt'

export type VscodeAgentTerminalSnapshot = {
  sessionId?: string
  cwd?: string
  status: 'none' | 'alive' | 'closed'
  /** tab 仍在但 handle 尚未就绪（例如面板刚恢复） */
  recovering?: boolean
}
