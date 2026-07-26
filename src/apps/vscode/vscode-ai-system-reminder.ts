import {
  VSCODE_AI_MODE_LABELS,
  type VscodeAiMode,
} from './vscode-ai-mode.ts'
import type {
  VscodeAgentTerminalSnapshot,
  VscodeAiTerminalKind,
} from './vscode-terminal-sessions.ts'

/** 写入各模式 system prompt，声明 <system-reminder> 语义 */
export const VSCODE_AI_SYSTEM_REMINDER_PREAMBLE = `用户消息中可能偶尔包含 <system-reminder> 标签。这些标签由系统在发生相关事件时自动注入，与用户原话无直接关系；其中的约束与提醒必须遵守。不要在对用户的回复中提及、复述或引用这些标签。`

export type VscodeAiLastSentTerminal = {
  kind: VscodeAiTerminalKind
  snapshot: VscodeAgentTerminalSnapshot
}

export type VscodeAiReminderEvent =
  | { type: 'mode_switch'; previous: VscodeAiMode; next: VscodeAiMode }
  | {
      type: 'terminal_lifecycle'
      kind: VscodeAiTerminalKind
      change: 'user_closed' | 'session_reset' | 'rebuilt'
      previousSessionId?: string
    }

const AI_TERMINAL_LABEL: Record<VscodeAiTerminalKind, string> = {
  ask: 'Ask',
  plan: 'Plan',
  agent: 'Agent',
}

function modeUsesTerminal(mode: VscodeAiMode): boolean {
  return mode === 'ask' || mode === 'plan' || mode === 'agent'
}

function renderModeSwitchEvent(event: Extract<VscodeAiReminderEvent, { type: 'mode_switch' }>): string[] {
  const { previous, next } = event
  const lines: string[] = [
    `模式刚从 ${VSCODE_AI_MODE_LABELS[previous]} 切换为 ${VSCODE_AI_MODE_LABELS[next]}。请立即按新模式的工具与权限行事，不要沿用上一模式的写法或副作用。`,
  ]
  const prevUsesTerminal = modeUsesTerminal(previous)
  const nextUsesTerminal = modeUsesTerminal(next)
  if (prevUsesTerminal && nextUsesTerminal) {
    lines.push(
      `${VSCODE_AI_MODE_LABELS[previous]} 与 ${VSCODE_AI_MODE_LABELS[next]} 各自绑定独立终端会话（Ask/Plan 只读，Agent 受控），不共享 cwd、内存变量与文件系统权限。勿假设上一模式终端里的状态仍在；本模式首次 run_in_terminal 可能是 kind=new，关闭后再开会是 kind=rebuilt。`,
    )
  } else if (prevUsesTerminal && !nextUsesTerminal) {
    lines.push(
      `当前模式不再使用终端工具；上一模式（${VSCODE_AI_MODE_LABELS[previous]}）的终端会话不会带到本模式。`,
    )
  } else if (!prevUsesTerminal && nextUsesTerminal) {
    lines.push(
      `本模式使用独立的 AI 终端会话；与其它模式不共享。首次 run_in_terminal 会新开（结果里 kind=new），勿假设已有 cwd 或内存状态。`,
    )
  }
  return lines
}

function renderTerminalLifecycleEvent(
  event: Extract<VscodeAiReminderEvent, { type: 'terminal_lifecycle' }>,
): string {
  const label = AI_TERMINAL_LABEL[event.kind]
  if (event.change === 'user_closed') {
    return `${label} 终端已被用户关闭。勿假设 cwd/内存变量仍在；下次 run_in_terminal 会自动新开（kind=rebuilt）。`
  }
  if (event.change === 'session_reset') {
    return `本对话绑定的 ${label} 终端实例已销毁（例如对话曾关闭后重开）。勿沿用旧终端状态；下次 run_in_terminal 会新开。`
  }
  const previous = event.previousSessionId ? ` 已从 ${event.previousSessionId}` : ''
  return `${label} 终端 session${previous} 换新。勿假设旧 cwd/内存仍在。`
}

export function collectVscodeAiReminderEvents(input: {
  mode: VscodeAiMode
  previousMode?: VscodeAiMode
  aiTerminalKind?: VscodeAiTerminalKind
  currentTerminal?: VscodeAgentTerminalSnapshot
  lastSentTerminal?: VscodeAiLastSentTerminal
}): VscodeAiReminderEvent[] {
  const events: VscodeAiReminderEvent[] = []
  const previous = input.previousMode
  if (previous && previous !== input.mode) {
    events.push({ type: 'mode_switch', previous, next: input.mode })
  }

  const kind = input.aiTerminalKind
  const last = input.lastSentTerminal
  if (kind && last && last.kind === kind) {
    const prev = last.snapshot
    const curr = input.currentTerminal ?? { status: 'none' as const }
    if (prev.status === 'alive') {
      if (curr.status === 'closed') {
        events.push({
          type: 'terminal_lifecycle',
          kind,
          change: 'user_closed',
          previousSessionId: prev.sessionId,
        })
      } else if (curr.status === 'none') {
        events.push({
          type: 'terminal_lifecycle',
          kind,
          change: 'session_reset',
          previousSessionId: prev.sessionId,
        })
      } else if (
        curr.status === 'alive' &&
        prev.sessionId &&
        curr.sessionId &&
        prev.sessionId !== curr.sessionId
      ) {
        events.push({
          type: 'terminal_lifecycle',
          kind,
          change: 'rebuilt',
          previousSessionId: prev.sessionId,
        })
      }
    }
  }

  return events
}

export function buildVscodeAiSystemReminder(events: readonly VscodeAiReminderEvent[]): string {
  if (events.length === 0) return ''
  const lines: string[] = []
  for (const event of events) {
    if (event.type === 'mode_switch') {
      lines.push(...renderModeSwitchEvent(event))
    } else {
      lines.push(renderTerminalLifecycleEvent(event))
    }
  }
  return lines.join('\n')
}

/** @deprecated 使用 collectVscodeAiReminderEvents + buildVscodeAiSystemReminder */
export function buildVscodeAiModeReminder(
  mode: VscodeAiMode,
  options?: {
    previousMode?: VscodeAiMode
    aiTerminalKind?: VscodeAiTerminalKind
    currentTerminal?: VscodeAgentTerminalSnapshot
    lastSentTerminal?: VscodeAiLastSentTerminal
  },
): string {
  return buildVscodeAiSystemReminder(
    collectVscodeAiReminderEvents({
      mode,
      previousMode: options?.previousMode,
      aiTerminalKind: options?.aiTerminalKind,
      currentTerminal: options?.currentTerminal,
      lastSentTerminal: options?.lastSentTerminal,
    }),
  )
}

export function wrapVscodeAiUserMessage(userText: string, reminder: string): string {
  const body = reminder.trim()
  if (!body) return userText
  return `<system-reminder>\n${body}\n</system-reminder>\n\n${userText}`
}

export function wrapVscodeAiUserMessageForMode(
  userText: string,
  mode: VscodeAiMode,
  previousMode?: VscodeAiMode,
): string {
  return wrapVscodeAiUserMessage(
    userText,
    buildVscodeAiSystemReminder(
      collectVscodeAiReminderEvents({ mode, previousMode }),
    ),
  )
}
