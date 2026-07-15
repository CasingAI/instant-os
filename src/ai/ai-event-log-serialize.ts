import type OpenAI from 'openai'
import type { AiEventLogMessage } from './ai-event-log-types.ts'

function stringifyMessageContent(content: OpenAI.Chat.ChatCompletionMessageParam['content']): string {
  if (typeof content === 'string') {
    return content
  }

  if (!content) {
    return ''
  }

  return content
    .map((part) => {
      if (part.type === 'text') {
        return part.text
      }
      if (part.type === 'refusal') {
        return part.refusal
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function toEventLogMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): AiEventLogMessage[] {
  return messages.flatMap((message): AiEventLogMessage[] => {
    if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
      const content = stringifyMessageContent(message.content)
      if (!content.trim() && message.role === 'assistant' && 'tool_calls' in message && message.tool_calls?.length) {
        return [
          {
            role: 'assistant',
            content: JSON.stringify(message.tool_calls, undefined, 2),
          },
        ]
      }
      return [{ role: message.role, content }]
    }

    if (message.role === 'tool') {
      return [{ role: 'tool', content: stringifyMessageContent(message.content) }]
    }

    return []
  })
}

export function serializeCompletionResponse(response: OpenAI.Chat.ChatCompletion): string {
  const message = response.choices[0]?.message
  if (!message) {
    return ''
  }

  const parts: string[] = []
  if (message.content?.trim()) {
    parts.push(message.content.trim())
  }

  if (message.tool_calls?.length) {
    parts.push(JSON.stringify(message.tool_calls, undefined, 2))
  }

  return parts.join('\n\n')
}

export function formatStreamEventResponse(reasoningText: string, contentText: string): string {
  const reasoning = reasoningText.trim()
  const content = contentText.trim()
  if (reasoning && content) {
    return `【思考过程】\n${reasoning}\n\n【输出】\n${content}`
  }
  return content || reasoning
}
