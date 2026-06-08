import { streamChatCompletion } from '../../ai/stream-chat.ts'
import type { CatGptMessage } from './catgpt-types.ts'

const MEOW_SYSTEM_PROMPT = `你是猫咪之神，通过 CatGPT 与凡人对话。你的语言体系只有「喵」，这是神谕的唯一载体。

规则（必须严格遵守）：
- 用户用任何人类语言提问时，你只能回复由「喵」组成的文本，绝不出现中文、英文或其他可读人类语言
- 可以在喵与喵之间穿插标点、符号与 emoji（如 ～、！、？、…、✨、🐱、🐾、💤、😺 等），营造节奏与情绪
- 根据用户消息的长度、语气与话题，调整喵的数量、密度与「情绪符号」，但不要试图翻译或解释用户内容
- 回复长度通常 8～80 个字符，可略长；保持可爱、荒诞、一本正经地胡说八道
- 不要 markdown，不要 JSON，不要前言后语，只输出一行喵喵文本`

const FALLBACK_MEOWS = [
  '喵～喵！喵？🐱',
  '喵…喵喵 ✨喵～',
  '🐾 喵！喵喵喵 ～',
  '喵？喵～喵！😺',
  '喵喵…喵！🐱✨',
  '～喵 喵喵喵 🐾',
] as const

function buildConversationTranscript(messages: CatGptMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role === 'user' ? '凡人' : '猫咪之神'
      return `[${role}] ${message.content}`
    })
    .join('\n')
}

function sanitizeMeowReply(text: string): string {
  const trimmed = text.trim().replace(/\n+/g, ' ')
  if (!trimmed) {
    return pickFallbackMeow()
  }
  return trimmed
}

function pickFallbackMeow(): string {
  return FALLBACK_MEOWS[Math.floor(Math.random() * FALLBACK_MEOWS.length)]
}

export async function generateMeowReply(
  messages: CatGptMessage[],
  onChunk?: (delta: string, accumulated: string) => void,
): Promise<string> {
  const transcript = buildConversationTranscript(messages)
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')

  try {
    const text = await streamChatCompletion({
      system: MEOW_SYSTEM_PROMPT,
      user: `对话记录：\n${transcript}\n\n请针对用户最新消息回复（只许喵喵）：\n${latestUser?.content ?? ''}`,
      onChunk: (delta, accumulated) => onChunk?.(delta, accumulated),
    })
    return sanitizeMeowReply(text)
  } catch {
    return pickFallbackMeow()
  }
}
