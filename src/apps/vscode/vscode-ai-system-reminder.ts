import {
  VSCODE_AI_MODE_LABELS,
  type VscodeAiMode,
} from './vscode-ai-mode.ts'

/** 写入各模式 system prompt，声明 <system-reminder> 语义 */
export const VSCODE_AI_SYSTEM_REMINDER_PREAMBLE = `用户消息中可能包含 <system-reminder> 标签。这些标签由系统自动注入，与用户原话无直接关系；其中的约束与提醒必须遵守。不要在对用户的回复中提及、复述或引用这些标签。`

export function buildVscodeAiModeReminder(
  mode: VscodeAiMode,
  options?: { previousMode?: VscodeAiMode },
): string {
  const lines: string[] = []
  const previous = options?.previousMode
  if (previous && previous !== mode) {
    lines.push(
      `模式刚从 ${VSCODE_AI_MODE_LABELS[previous]} 切换为 ${VSCODE_AI_MODE_LABELS[mode]}。请立即按新模式的工具与权限行事，不要沿用上一模式的写法或副作用。`,
    )
    const prevUsesTerminal = previous === 'ask' || previous === 'plan' || previous === 'agent'
    const nextUsesTerminal = mode === 'ask' || mode === 'plan' || mode === 'agent'
    if (prevUsesTerminal && nextUsesTerminal) {
      lines.push(
        `${VSCODE_AI_MODE_LABELS[previous]} 与 ${VSCODE_AI_MODE_LABELS[mode]} 各自绑定独立终端会话（Ask/Plan 只读，Agent 受控），不共享 cwd、内存变量与文件系统权限。勿假设上一模式终端里的状态仍在；本模式首次 run_in_terminal 可能是 kind=new，关闭后再开会是 kind=rebuilt。`,
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
  }

  if (mode === 'ask') {
    lines.push(
      '当前模式：Ask（只读）。只能用 run_in_terminal 在只读终端中读取；写/删/建文件与 npm/npx 均不可用。回答用简洁中文。',
    )
  } else if (mode === 'plan') {
    lines.push(
      [
        '当前模式：Plan（只读协作规划）。不得修改业务代码或运行 npm/npx。',
        '用 run_in_terminal（只读）调研；唯一写出口是 write_plan（写入工作区 .vscode/plans/*.md 并打开）。',
        '需求不清时先问 1–2 个关键问题，再写计划。信息足够后必须调用 write_plan 落盘，不要只用聊天长文替代。',
        '计划须具体可执行：选定一种方案写死，禁止 Option A/B、TBD、「视情况」。',
        '落盘 Markdown 建议含：# 标题、overview、实现要点（关键路径）、todos checklist；复杂时可用 mermaid。',
        '写完计划即可结束本轮，不要开始改业务代码。',
      ].join(' '),
    )
  } else if (mode === 'edit') {
    lines.push(
      '当前模式：Edit。可用读取类工具了解工作区，通过 propose_file_edit 提交修改提案（用户确认后才写入）。不得执行终端/npm。',
    )
  } else {
    lines.push(
      '当前模式：Agent。读写与副作用一律走受控终端（run_in_terminal / npm_run / npx）；调用 run_in_terminal 须带 description。多文件改动尽量合并同一次执行以便回滚。',
    )
  }

  return lines.join('\n')
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
    buildVscodeAiModeReminder(mode, { previousMode }),
  )
}
