import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import type { AiProviderId } from '../../ai/ai-providers.ts'
import { hasOpenAiApiKey, mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import {
  boardToAscii,
  formatCoord,
  isValidMove,
  parseCoord,
  pickFallbackMove,
  playerLabel,
  type Board,
  type Player,
} from './gomoku-logic.ts'

const GOMOKU_AI_PROMPT = `你是五子棋 AI。棋盘 15×15，黑棋 X 先手，白棋 O 后手，先连成五子者胜。
坐标格式：列 A~O，行 1~15（如 H8 表示第 8 行 H 列）。
只输出一个合法空位的坐标（如 H8），不要解释、不要 markdown、不要其它文字。`

type AiMessage = {
  content?: string | null
  reasoning_content?: string | null
}

/** 五子棋落子只需一个坐标；DeepSeek 无论账户是否开启思维链，均强制关闭。 */
function buildGomokuAiRequestExtras(providerId: AiProviderId | undefined): ReturnType<typeof buildThinkingRequestExtras> {
  return buildThinkingRequestExtras(providerId, false)
}

function readAiMessageText(message: AiMessage | undefined): string {
  if (!message) return ''
  return (message.content ?? message.reasoning_content ?? '').trim()
}

export async function pickAiMove(board: Board, aiPlayer: Player): Promise<{ row: number; col: number }> {
  if (!hasOpenAiApiKey()) {
    return pickFallbackMove(board, aiPlayer)
  }

  try {
    const config = mergeOpenAiConfig()
    const client = getOpenAiClient(config)
    const response = await client.chat.completions.create({
      model: config.defaultModel,
      messages: [
        { role: 'system', content: GOMOKU_AI_PROMPT },
        {
          role: 'user',
          content: `你执${playerLabel(aiPlayer)}。当前棋盘：\n${boardToAscii(board)}\n请落子。`,
        },
      ],
      ...buildGomokuAiRequestExtras(config.providerId),
    })

    const text = readAiMessageText(response.choices[0]?.message as AiMessage | undefined)
    const parsed = parseCoord(text)
    if (parsed && isValidMove(board, parsed.row, parsed.col)) {
      return parsed
    }

    for (const token of text.split(/[\s,，、]+/)) {
      const candidate = parseCoord(token)
      if (candidate && isValidMove(board, candidate.row, candidate.col)) {
        return candidate
      }
    }
  } catch {
    // 回退到本地启发式
  }

  return pickFallbackMove(board, aiPlayer)
}

export function describeAiMove(row: number, col: number): string {
  return formatCoord(row, col)
}
