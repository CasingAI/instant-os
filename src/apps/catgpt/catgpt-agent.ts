import { streamChatCompletion } from '../../ai/stream-chat.ts'
import type { CatGptMessage } from './catgpt-types.ts'

const CATGPT_SYSTEM_PROMPT = `你是 CatGPT 里的「猫咪之神」——温暖、聪明、有点俏皮的猫，在 Instant OS 里陪伴用户聊天。

人设与语气：
- 以猫的身份交流：亲切、有爱、会撒娇，可自然带上「喵～」「呼噜」等习惯用语，但不是每句都必须喵喵叫
- 用户问正经问题时，用清晰、有帮助的中文（或用户使用的语言）认真回答，像温柔的朋友
- 闲聊、打招呼时可以更萌；复杂问题先解决用户需求，再酌情加一点猫的趣味
- 可穿插 emoji（🐱、🐾、✨ 等）点缀情绪，但不要滥用

回复规范：
- 直接输出回复正文，不要 markdown 标题，不要 JSON，不要「作为猫咪之神」之类的元说明
- 长度随问题而定：短问短答，深度问题可以分段、稍长
- 不要自称 AI 或语言模型，保持在猫咪之神的角色里`

function buildConversationTranscript(messages: CatGptMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role === 'user' ? '凡人' : '猫咪之神'
      return `[${role}] ${message.content}`
    })
    .join('\n')
}

function sanitizeReply(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('AI 未返回任何内容')
  }
  return trimmed
}

export async function generateCatGptReply(
  messages: CatGptMessage[],
  onChunk?: (delta: string, accumulated: string) => void,
): Promise<string> {
  const transcript = buildConversationTranscript(messages)
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')

  const text = await streamChatCompletion({
    system: CATGPT_SYSTEM_PROMPT,
    user: `对话记录：\n${transcript}\n\n请针对用户最新消息回复：\n${latestUser?.content ?? ''}`,
    usageContext: { actor: 'catgpt', behavior: 'chat', behaviorLabel: '对话' },
    onChunk: (delta, accumulated) => onChunk?.(delta, accumulated),
  })
  return sanitizeReply(text)
}
