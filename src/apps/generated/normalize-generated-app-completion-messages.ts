import type OpenAI from 'openai'

type GeneratedAppChatRole = 'system' | 'user' | 'assistant' | 'tool'

const ROLE_ALIASES: Record<string, GeneratedAppChatRole> = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
  tool: 'tool',
  ai: 'assistant',
  bot: 'assistant',
  model: 'assistant',
  chatbot: 'assistant',
  human: 'user',
}

export function normalizeGeneratedAppChatMessages(
  messages: unknown,
): OpenAI.Chat.ChatCompletionMessageParam[] | undefined {
  if (!Array.isArray(messages)) {
    return undefined
  }

  const normalized: OpenAI.Chat.ChatCompletionMessageParam[] = []

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue
    }

    const record = message as Record<string, unknown>
    const rawRole = record.role
    if (typeof rawRole !== 'string') {
      continue
    }

    const role = ROLE_ALIASES[rawRole.trim().toLowerCase()]
    if (!role) {
      continue
    }

    const content = record.content
    if (typeof content !== 'string') {
      continue
    }

    const trimmedContent = content.trim()
    if (!trimmedContent) {
      continue
    }

    if (role === 'tool') {
      const toolCallId = record.tool_call_id
      if (typeof toolCallId !== 'string' || !toolCallId.trim()) {
        continue
      }
      normalized.push({
        role: 'tool',
        content: trimmedContent,
        tool_call_id: toolCallId.trim(),
      })
      continue
    }

    normalized.push({ role, content: trimmedContent })
  }

  return normalized.length > 0 ? normalized : undefined
}
