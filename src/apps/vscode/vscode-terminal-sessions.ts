import type { TerminalFsMode } from '../../terminal/terminal-fs-mode.ts'
import { osNowMs } from '../../os/os-clock.ts'

/** AI 对话绑定的终端：Ask/Plan=只读，Agent=受控可写 */
export type VscodeAiTerminalKind = 'ask' | 'plan' | 'agent'

export type VscodeTerminalSessionKind = 'user' | VscodeAiTerminalKind

export type VscodeTerminalSession = {
  id: string
  title: string
  kind: VscodeTerminalSessionKind
  /** ask/plan/agent 会话绑定的 AI chat sessionId */
  ownerChatId?: string
  fsMode: TerminalFsMode
}

export function isVscodeAiTerminalKind(
  kind: VscodeTerminalSessionKind,
): kind is VscodeAiTerminalKind {
  return kind === 'ask' || kind === 'plan' || kind === 'agent'
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

const AI_TERMINAL_LABEL: Record<VscodeAiTerminalKind, string> = {
  ask: 'Ask',
  plan: 'Plan',
  agent: 'Agent',
}

export function createAiTerminalSession(
  kind: VscodeAiTerminalKind,
  ownerChatId: string,
  chatTitle: string,
): VscodeTerminalSession {
  const short = chatTitle.trim() || '对话'
  return {
    id: createVscodeTerminalSessionId(),
    title: `${AI_TERMINAL_LABEL[kind]} · ${short.slice(0, 24)}`,
    kind,
    ownerChatId,
    fsMode: kind === 'agent' ? 'controlled' : 'readonly',
  }
}

export function createAgentTerminalSession(
  ownerChatId: string,
  chatTitle: string,
): VscodeTerminalSession {
  return createAiTerminalSession('agent', ownerChatId, chatTitle)
}

export function createAskTerminalSession(
  ownerChatId: string,
  chatTitle: string,
): VscodeTerminalSession {
  return createAiTerminalSession('ask', ownerChatId, chatTitle)
}

export function createPlanTerminalSession(
  ownerChatId: string,
  chatTitle: string,
): VscodeTerminalSession {
  return createAiTerminalSession('plan', ownerChatId, chatTitle)
}

export type VscodeAgentTerminalEnsureReason = 'reused' | 'new' | 'rebuilt'

export type VscodeAgentTerminalSnapshot = {
  sessionId?: string
  cwd?: string
  /** Session 级临时目录，如 /tmp/Terminal/{id} */
  tmpdir?: string
  status: 'none' | 'alive' | 'closed'
  /** tab 仍在但 handle 尚未就绪（例如面板刚恢复） */
  recovering?: boolean
}
