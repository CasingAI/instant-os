import { formatHumanDurationMs } from '../../ai/format-human-duration.ts'
import type { VscodeAiInvestigation } from './vscode-ai-agent.ts'
import type { VscodeAiChatMessage } from './vscode-ai-chat-storage.ts'

export type VscodeAiConversationDumpOptions = {
  sessionId?: string
  title?: string
}

function messageRoleLabel(role: VscodeAiChatMessage['role']): string {
  return role === 'user' ? '用户' : '助手'
}

/** 与 UI 摘要一致的调查统计（独立实现，避免测试/Node 环境引入 .tsx） */
export function formatDumpInvestigationSummary(
  investigation: VscodeAiInvestigation,
): string {
  const parts: string[] = []
  if (
    investigation.reasoningDurationMs !== undefined &&
    investigation.reasoningDurationMs >= 5000
  ) {
    parts.push(`思考 ${formatHumanDurationMs(investigation.reasoningDurationMs)}`)
  }
  parts.push(
    investigation.toolCallCount > 0
      ? `调用 ${investigation.toolCallCount} 个工具`
      : '未调用工具',
  )
  parts.push(`用时 ${formatHumanDurationMs(investigation.durationMs)}`)
  return parts.join(' · ')
}

function investigationToolLines(investigation: VscodeAiInvestigation): string[] {
  const lines: string[] = []
  for (const activity of investigation.activities) {
    const label = [activity.label, activity.detail].filter(Boolean).join(' · ')
    lines.push(
      `  - ${label}${activity.subagentRunId ? ` [runId: ${activity.subagentRunId}]` : ''}`,
    )
    if (activity.content?.trim()) {
      lines.push(`    输入：${activity.content.trim()}`)
    }
    if (activity.result?.trim()) {
      lines.push(`    输出：${activity.result.trim()}`)
    }
  }
  return lines
}

/**
 * 把 Agent 对话序列化为可粘贴的调试转储文本：
 * 每轮用户/助手消息 + 状态标记 + 调查摘要 + 工具调用明细 + system-reminder。
 * 供「复制对话」按钮使用，方便把现场状态直接交给 AI 排查。
 */
export function buildVscodeAiConversationDump(
  messages: readonly VscodeAiChatMessage[],
  options?: VscodeAiConversationDumpOptions,
): string {
  const lines: string[] = []
  if (options?.title) lines.push(options.title)
  if (options?.sessionId) lines.push(`会话 ID: ${options.sessionId}`)
  lines.push(`对话调试转储 · 共 ${messages.length} 条消息`)
  lines.push('')

  messages.forEach((message, index) => {
    const flags = [
      message.isError ? '出错' : undefined,
      message.incomplete ? '未完整结束' : undefined,
    ].filter(Boolean)
    lines.push(
      `── [${index + 1}] ${messageRoleLabel(message.role)}${flags.length > 0 ? `（${flags.join('，')}）` : ''} ──`,
    )
    if (message.investigation) {
      lines.push(`调查：${formatDumpInvestigationSummary(message.investigation)}`)
      const toolLines = investigationToolLines(message.investigation)
      if (toolLines.length > 0) {
        lines.push('工具调用：')
        lines.push(...toolLines)
      }
      if (message.investigation.reasoningText?.trim()) {
        lines.push('思考：')
        lines.push(message.investigation.reasoningText.trim())
      }
    }
    if (message.systemReminder?.trim()) {
      lines.push('System Reminder：')
      lines.push(message.systemReminder.trim())
    }
    lines.push('正文：')
    lines.push(message.content.trim() || '（无正文）')
    lines.push('')
  })

  return `${lines.join('\n').trimEnd()}\n`
}

/** 复制文本到剪贴板（Clipboard API 失败时回退 execCommand） */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      return ok
    } catch {
      return false
    }
  }
}
