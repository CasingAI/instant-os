import type OpenAI from 'openai'
import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import { toEventLogMessages } from '../../ai/ai-event-log.ts'
import { recordOpenAiCompletionUsage } from '../../ai/openai-usage.ts'
import { hasOpenAiApiKey, mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import {
  boardToAscii,
  formatCoord,
  formatOccupiedCoordsList,
  isValidMove,
  parseCoord,
  pickFallbackMove,
  playerLabel,
  type Board,
  type MoveRecord,
  type Player,
} from './gomoku-logic.ts'

const GOMOKU_AI_PROMPT = `你是五子棋 AI。棋盘 15×15，黑棋 X 先手，白棋 O 后手，先连成五子者胜。
坐标格式：列 A~O，行 1~15（如 H8 表示第 8 行 H 列）。
认真对弈并争取获胜：在合法空位中选择对局面最有利的落点（进攻连五、做活、堵截对手威胁等），不要随手乱下。
每回合请先输出简短正文，分析局面与着手意图（尤其是否需堵截或延续攻势），然后调用 place_stone 工具提交落子；坐标只能通过工具提交，不要只在正文中写坐标。`

const MAX_REMOTE_ATTEMPTS = 4

const GOMOKU_PLACE_STONE_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'place_stone',
    description: '在棋盘合法空位落子。coord 为列 A~O、行 1~15，如 H8。',
    parameters: {
      type: 'object',
      properties: {
        coord: {
          type: 'string',
          description: '落子坐标，如 H8',
        },
      },
      required: ['coord'],
      additionalProperties: false,
    },
  },
}

export const GOMOKU_HEURISTIC_AI_NAME = '本地启发式 AI'

export type GomokuAiDegradeReason = 'offline' | 'invalid-response'

export type GomokuAiThinkingLabel = 'default' | 'retry-thinking' | 'retry-final'

export type PickAiMoveOptions = {
  onThinkingLabel?: (label: GomokuAiThinkingLabel) => void
  lastMove?: MoveRecord
  /** AI 对战 AI 时启用 DeepSeek 思考模式，并使用更深度的思考状态文案 */
  thinkingMode?: boolean
}

export type GomokuAiMoveResult = {
  row: number
  col: number
  degradeReason?: GomokuAiDegradeReason
}

type RemoteAiMoveSuccess = {
  ok: true
  row: number
  col: number
}

type RemoteAiMoveFailure = {
  ok: false
  reason: GomokuAiDegradeReason
}

type ParsedPlaceStoneToolCall = {
  id: string
  coord: string
}

type RemoteAiMoveResponse = {
  content: string
  toolCall?: ParsedPlaceStoneToolCall
}

function thinkingLabelForAttempt(attempt: number): GomokuAiThinkingLabel {
  if (attempt <= 1) {
    return 'default'
  }
  if (attempt === 2) {
    return 'retry-thinking'
  }
  return 'retry-final'
}

function resolveThinkingLabel(attempt: number, thinkingMode: boolean): GomokuAiThinkingLabel {
  if (!thinkingMode) {
    return thinkingLabelForAttempt(attempt)
  }
  return thinkingLabelForAttempt(Math.min(attempt + 2, MAX_REMOTE_ATTEMPTS - 1))
}

function buildOccupiedSection(board: Board): string {
  const occupiedCoords = formatOccupiedCoordsList(board)
  return occupiedCoords
    ? `已有棋子（不可重复落子，坐标·颜色/XO）：${occupiedCoords}`
    : '当前棋盘上尚无棋子。'
}

function buildOpponentMoveSection(lastMove: MoveRecord | undefined, aiPlayer: Player): string | undefined {
  if (!lastMove || lastMove.player === aiPlayer) {
    return undefined
  }
  const stoneMark = lastMove.player === 1 ? 'X' : 'O'
  return `对手上一手：${formatCoord(lastMove.row, lastMove.col)}（${playerLabel(lastMove.player)}/${stoneMark}）。请针对此着手决定是堵截、对攻还是扩张。`
}

function buildInitialUserMessage(board: Board, aiPlayer: Player, lastMove?: MoveRecord): string {
  const opponentSection = buildOpponentMoveSection(lastMove, aiPlayer)
  return [
    `你执${playerLabel(aiPlayer)}。`,
    opponentSection,
    buildOccupiedSection(board),
    `当前棋盘：\n${boardToAscii(board)}`,
    '请先简要分析局面，再调用 place_stone 提交合法空位坐标。',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function parsePlaceStoneToolCall(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
): ParsedPlaceStoneToolCall | undefined {
  const toolCall = message?.tool_calls?.find(
    (call) => call.type === 'function' && call.function.name === 'place_stone',
  )
  if (!toolCall || toolCall.type !== 'function') {
    return undefined
  }

  let coord = ''
  try {
    const args = JSON.parse(toolCall.function.arguments) as { coord?: string }
    coord = typeof args.coord === 'string' ? args.coord.trim() : ''
  } catch {
    coord = ''
  }

  return { id: toolCall.id, coord }
}

function findValidMove(board: Board, coord: string): { row: number; col: number } | undefined {
  const parsed = parseCoord(coord)
  if (parsed && isValidMove(board, parsed.row, parsed.col)) {
    return parsed
  }

  for (const token of coord.split(/[\s,，、]+/)) {
    const candidate = parseCoord(token)
    if (candidate && isValidMove(board, candidate.row, candidate.col)) {
      return candidate
    }
  }

  return undefined
}

function describeOccupiedStone(board: Board, row: number, col: number): string {
  const stone = board[row][col]
  if (stone === 0) {
    return formatCoord(row, col)
  }
  const stoneMark = stone === 1 ? 'X' : 'O'
  return `${formatCoord(row, col)}（${playerLabel(stone)}/${stoneMark}）`
}

function describeWrongCoordDetail(board: Board, coord: string): string {
  const trimmed = coord.trim()
  if (!trimmed) {
    return 'place_stone 未提供有效 coord。'
  }

  const parsed = parseCoord(trimmed)
  if (!parsed) {
    return `coord「${trimmed}」不是合法坐标格式。`
  }

  if (!isValidMove(board, parsed.row, parsed.col)) {
    return `${describeOccupiedStone(board, parsed.row, parsed.col)} 已有棋子，不能落子。`
  }

  return `coord「${trimmed}」无效。`
}

function buildRetryUserMessage(
  board: Board,
  aiPlayer: Player,
  coord: string,
  failedAttempt: number,
  lastMove?: MoveRecord,
): string {
  const wrongDetail = describeWrongCoordDetail(board, coord)
  const opponentSection = buildOpponentMoveSection(lastMove, aiPlayer)
  const strategyLine =
    failedAttempt === 0
      ? '请重新落子。仍需认真对弈，在空位中选择尽可能强的着手（连攻、做活、阻挡对手连五等），不要随手选点。'
      : '请重新落子。继续认真对弈，选择对局面最有利的合法空位。'

  return [
    `你执${playerLabel(aiPlayer)}。`,
    opponentSection,
    `上一手无效：${wrongDetail}`,
    buildOccupiedSection(board),
    `当前棋盘：\n${boardToAscii(board)}`,
    `${strategyLine}先简要分析，再调用 place_stone 提交坐标。`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function buildNoToolCallRetryMessage(board: Board, aiPlayer: Player, lastMove?: MoveRecord): string {
  const opponentSection = buildOpponentMoveSection(lastMove, aiPlayer)
  return [
    `你执${playerLabel(aiPlayer)}。`,
    opponentSection,
    '你尚未调用 place_stone 工具。',
    buildOccupiedSection(board),
    `当前棋盘：\n${boardToAscii(board)}`,
    '请先简要分析局面，再调用 place_stone 提交合法空位坐标。',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function describeToolResultError(board: Board, coord: string): string {
  return describeWrongCoordDetail(board, coord)
}

function buildAssistantMessage(response: RemoteAiMoveResponse): OpenAI.Chat.ChatCompletionMessageParam {
  if (!response.toolCall) {
    return {
      role: 'assistant',
      content: response.content || '（空回复）',
    }
  }

  return {
    role: 'assistant',
    content: response.content || undefined,
    tool_calls: [
      {
        id: response.toolCall.id,
        type: 'function',
        function: {
          name: 'place_stone',
          arguments: JSON.stringify({ coord: response.toolCall.coord }),
        },
      },
    ],
  }
}

function buildLocalMove(
  board: Board,
  aiPlayer: Player,
  degradeReason: GomokuAiDegradeReason | undefined,
): GomokuAiMoveResult {
  const move = pickFallbackMove(board, aiPlayer)
  return { ...move, degradeReason }
}

async function requestRemoteAiMove(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  thinkingEnabled: boolean,
): Promise<RemoteAiMoveResponse> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const response = await client.chat.completions.create({
    model: config.defaultModel,
    messages,
    tools: [GOMOKU_PLACE_STONE_TOOL],
    tool_choice: 'auto',
    ...buildThinkingRequestExtras(config.providerId, thinkingEnabled),
  })

  recordOpenAiCompletionUsage(response, {
    actor: 'gomoku',
    behavior: 'ai-move',
    behaviorLabel: 'AI 落子',
  }, {
    model: config.defaultModel,
    thinkingEnabled,
    messages: toEventLogMessages(messages),
  })

  const message = response.choices[0]?.message
  return {
    content: (message?.content ?? '').trim(),
    toolCall: parsePlaceStoneToolCall(message),
  }
}

async function tryPickRemoteAiMoveWithRetries(
  board: Board,
  aiPlayer: Player,
  options?: PickAiMoveOptions,
): Promise<RemoteAiMoveSuccess | RemoteAiMoveFailure> {
  const lastMove = options?.lastMove
  const thinkingMode = options?.thinkingMode ?? false
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: GOMOKU_AI_PROMPT },
    { role: 'user', content: buildInitialUserMessage(board, aiPlayer, lastMove) },
  ]

  for (let attempt = 0; attempt < MAX_REMOTE_ATTEMPTS; attempt += 1) {
    options?.onThinkingLabel?.(resolveThinkingLabel(attempt, thinkingMode))

    try {
      const response = await requestRemoteAiMove(messages, thinkingMode)
      const coord = response.toolCall?.coord ?? ''
      const move = coord ? findValidMove(board, coord) : undefined
      if (move) {
        return { ok: true, ...move }
      }

      if (attempt >= MAX_REMOTE_ATTEMPTS - 1) {
        break
      }

      messages.push(buildAssistantMessage(response))

      if (response.toolCall) {
        messages.push({
          role: 'tool',
          tool_call_id: response.toolCall.id,
          content: describeToolResultError(board, response.toolCall.coord),
        })
        messages.push({
          role: 'user',
          content: buildRetryUserMessage(board, aiPlayer, response.toolCall.coord, attempt, lastMove),
        })
      } else {
        messages.push({
          role: 'user',
          content: buildNoToolCallRetryMessage(board, aiPlayer, lastMove),
        })
      }
    } catch {
      return { ok: false, reason: 'offline' }
    }
  }

  return { ok: false, reason: 'invalid-response' }
}

/** 探测远程 AI 服务是否可达（用于离线降级后恢复检测） */
export async function probeGomokuAiServiceReachable(): Promise<boolean> {
  if (!hasOpenAiApiKey()) {
    return false
  }

  try {
    const config = mergeOpenAiConfig()
    const client = getOpenAiClient(config)
    await client.chat.completions.create({
      model: config.defaultModel,
      max_tokens: 4,
      messages: [
        { role: 'system', content: '只回复 OK。' },
        { role: 'user', content: 'ping' },
      ],
      ...buildThinkingRequestExtras(config.providerId, false),
    })
    return true
  } catch {
    return false
  }
}

export function pickHeuristicMove(board: Board, aiPlayer: Player): GomokuAiMoveResult {
  return pickFallbackMove(board, aiPlayer)
}

export async function pickAiMove(
  board: Board,
  aiPlayer: Player,
  options?: PickAiMoveOptions,
): Promise<GomokuAiMoveResult> {
  if (!hasOpenAiApiKey()) {
    return buildLocalMove(board, aiPlayer, undefined)
  }

  const remote = await tryPickRemoteAiMoveWithRetries(board, aiPlayer, options)
  if (remote.ok) {
    return { row: remote.row, col: remote.col, degradeReason: undefined }
  }

  return buildLocalMove(board, aiPlayer, remote.reason)
}

export function describeAiMove(row: number, col: number): string {
  return formatCoord(row, col)
}

export function gomokuAiThinkingStatusText(label: GomokuAiThinkingLabel): string {
  if (label === 'retry-thinking') {
    return '深度思考中…'
  }
  if (label === 'retry-final') {
    return '准备做出最终决定…'
  }
  return '思考中…'
}

export function gomokuAiDegradeBannerMessage(reason: GomokuAiDegradeReason): string {
  if (reason === 'offline') {
    return '无法连接 AI 服务，已切换为本地启发式 AI'
  }
  return 'AI 多次落子无效，已切换为本地启发式 AI'
}

export function gomokuAiDegradeOpponentLabel(reason: GomokuAiDegradeReason): string {
  if (reason === 'offline') {
    return '本地启发式 AI（离线降级）'
  }
  return '本地启发式 AI（无效落子降级）'
}
