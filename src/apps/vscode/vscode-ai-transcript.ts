import type OpenAI from 'openai'

/** 去掉规范 transcript 开头的 system，供下一轮 history 使用 */
export function stripLeadingSystemMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (messages[0]?.role === 'system') return messages.slice(1)
  return messages
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text ?? '')
      }
      return ''
    })
    .join('')
}

export function isSyntheticUserContextMessage(content: unknown): boolean {
  const text = contentToText(content)
  return (
    text.includes('<context-compaction') ||
    text.startsWith('[earlier_turns_omitted') ||
    text.startsWith('[folded_tools]')
  )
}

/**
 * 截取第 userOrdinal 个真实 user 消息之前的规范 transcript（编辑重发用）。
 */
export function sliceApiTranscriptBeforeUserOrdinal(
  transcript: OpenAI.Chat.ChatCompletionMessageParam[],
  userOrdinal: number,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  let seen = 0
  for (let i = 0; i < transcript.length; i += 1) {
    const message = transcript[i]
    if (message?.role !== 'user') continue
    if (isSyntheticUserContextMessage('content' in message ? message.content : '')) {
      continue
    }
    if (seen === userOrdinal) {
      return stripLeadingSystemMessages(transcript.slice(0, i))
    }
    seen += 1
  }
  return stripLeadingSystemMessages(transcript)
}
