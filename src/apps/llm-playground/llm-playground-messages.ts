import type OpenAI from 'openai'
import type { LlmPlaygroundMessage, LlmPlaygroundRole } from './llm-playground-types.ts'

const PLAYGROUND_ROLE_LABELS: Record<LlmPlaygroundRole, string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
}

/** 按消息列表构建 OpenAI 兼容的纯文本消息数组（跳过空内容） */
export function buildPlaygroundMessages(
  messages: LlmPlaygroundMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = []
  for (const message of messages) {
    const content = message.content.trim()
    if (!content) continue
    result.push({ role: message.role, content })
  }
  return result
}

/** 把整个对话格式化为可粘贴的文本（跳过空内容）；空对话返回空字符串 */
export function formatPlaygroundConversation(messages: LlmPlaygroundMessage[]): string {
  const blocks: string[] = []
  for (const message of messages) {
    const content = message.content.trim()
    if (!content) continue
    blocks.push(`[${PLAYGROUND_ROLE_LABELS[message.role]}]\n${content}`)
  }
  return blocks.join('\n\n')
}

/** 解析逗号分隔的停止序列；空返回 undefined（不发送） */
export function parsePlaygroundStopSequence(value: string): string[] | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}
