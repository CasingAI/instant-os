import { contentToText, type ChatMessage } from './types.ts'
import { headTail } from './tool-observation-budget.ts'

const PER_TOOL_RESULT_CHARS = 500

/**
 * 将轨迹序列化为压缩器可读文本，并按约 token 预算做二次 head/tail。
 * tokenBudget 按 2.5 字符/token 换算为字符上限。
 */
export function headTailSerializeCap(slice: ChatMessage[], tokenBudget: number): string {
  const charBudget = Math.max(4_000, Math.floor(tokenBudget * 2.5))
  const parts: string[] = []

  for (let i = 0; i < slice.length; i += 1) {
    const message = slice[i]!
    if (message.role === 'system') {
      parts.push(`### system\n${clip(contentToText(message.content), 2_000)}`)
      continue
    }
    if (message.role === 'user') {
      parts.push(`### user\n${clip(contentToText(message.content), 4_000)}`)
      continue
    }
    if (message.role === 'assistant') {
      const text = contentToText(message.content)
      const toolCalls =
        'tool_calls' in message && Array.isArray(message.tool_calls)
          ? message.tool_calls
          : undefined
      const lines = [`### assistant`]
      if (text) lines.push(clip(text, 2_000))
      if (toolCalls?.length) {
        for (const call of toolCalls) {
          if (call.type !== 'function') continue
          lines.push(
            `tool_call ${call.function.name}(${clip(call.function.arguments ?? '', 300)})`,
          )
        }
      }
      parts.push(lines.join('\n'))
      continue
    }
    if (message.role === 'tool') {
      const id = 'tool_call_id' in message ? message.tool_call_id : ''
      parts.push(
        `### tool ${id}\n${clip(contentToText(message.content), PER_TOOL_RESULT_CHARS)}`,
      )
    }
  }

  const joined = parts.join('\n\n')
  if (joined.length <= charBudget) return joined
  return headTail(joined, Math.floor(charBudget * 0.45), Math.floor(charBudget * 0.45))
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}
