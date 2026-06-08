import { buildThinkingRequestExtras, readStreamDelta } from './ai-thinking.ts'
import { mergeOpenAiConfig } from './openai-config.ts'
import { getOpenAiClient } from './openai-client.ts'

export type StreamChatOptions = {
  system: string
  user: string
  onChunk: (delta: string, accumulated: string) => void
}

export async function streamChatCompletion(options: StreamChatOptions): Promise<string> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const model = config.defaultModel

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    ...buildThinkingRequestExtras(config.providerId, config.thinkingEnabled),
  })

  let text = ''

  for await (const chunk of stream) {
    const { reasoning, content } = readStreamDelta(chunk.choices[0]?.delta)
    if (reasoning) {
      continue
    }
    if (!content) {
      continue
    }

    text += content
    options.onChunk(content, text)
  }

  if (!text.trim()) {
    throw new Error('AI 未返回任何内容')
  }

  return text.trim()
}
