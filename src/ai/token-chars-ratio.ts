import { loadRecentAiEventLogs } from './ai-event-log-storage.ts'
import type { AiEventLogRecord } from './ai-event-log-types.ts'

/** 尚无足够历史样本时的回退值（约 3~4 字符 / token） */
export const DEFAULT_CHARS_PER_TOKEN = 3.5

/** 至少这么多条真实用量记录才启用学习比例 */
const MIN_SAMPLES = 3

/** 累计 completion+prompt token 至少这么多才启用，避免小样本噪声 */
const MIN_TOTAL_TOKENS = 200

const HYDRATE_LOG_LIMIT = 300

type ModelRatioStats = {
  totalChars: number
  totalTokens: number
  sampleCount: number
}

const byModel = new Map<string, ModelRatioStats>()
const seenEventIds = new Set<string>()

let hydrated = false
let hydratePromise: Promise<void> | undefined

function hasEnoughData(stats: ModelRatioStats): boolean {
  return stats.sampleCount >= MIN_SAMPLES && stats.totalTokens >= MIN_TOTAL_TOKENS
}

function messageChars(messages: AiEventLogRecord['messages'] | undefined): number {
  if (!messages?.length) {
    return 0
  }
  let total = 0
  for (const message of messages) {
    total += message.content.length
  }
  return total
}

function qualifyRecord(record: Pick<
  AiEventLogRecord,
  | 'model'
  | 'status'
  | 'usageEstimated'
  | 'promptTokens'
  | 'completionTokens'
  | 'response'
  | 'messages'
>): record is typeof record & { model: string } {
  if (!record.model?.trim()) {
    return false
  }
  if (record.status !== 'success') {
    return false
  }
  if (record.usageEstimated === true) {
    return false
  }
  const promptTokens = record.promptTokens ?? 0
  const completionTokens = record.completionTokens ?? 0
  if (promptTokens + completionTokens <= 0) {
    return false
  }
  const chars = messageChars(record.messages) + (record.response?.length ?? 0)
  return chars > 0
}

function addSample(record: AiEventLogRecord): void {
  if (!qualifyRecord(record)) {
    return
  }
  if (seenEventIds.has(record.id)) {
    return
  }

  const chars = messageChars(record.messages) + record.response.length
  const tokens = (record.promptTokens ?? 0) + (record.completionTokens ?? 0)
  if (chars <= 0 || tokens <= 0) {
    return
  }

  seenEventIds.add(record.id)
  const existing = byModel.get(record.model)
  if (existing) {
    existing.totalChars += chars
    existing.totalTokens += tokens
    existing.sampleCount += 1
    return
  }

  byModel.set(record.model, {
    totalChars: chars,
    totalTokens: tokens,
    sampleCount: 1,
  })
}

/** 从事件日志记录学习该模型的字符/token 比例（真实用量、非估算）。 */
export function observeTokenCharsRatioFromEventLog(record: AiEventLogRecord): void {
  void ensureTokenCharsRatioHydrated()
  addSample(record)
}

/** 启动时 / 首次估算前，用近期历史事件重建比例。 */
export function ensureTokenCharsRatioHydrated(): Promise<void> {
  if (hydrated) {
    return Promise.resolve()
  }
  if (hydratePromise) {
    return hydratePromise
  }

  hydratePromise = loadRecentAiEventLogs(HYDRATE_LOG_LIMIT)
    .then((records) => {
      for (const record of records) {
        addSample(record)
      }
      hydrated = true
    })
    .catch(() => {
      hydrated = true
    })
    .finally(() => {
      hydratePromise = undefined
    })

  return hydratePromise
}

/** 清空历史事件日志时同步丢掉学习样本。 */
export function resetTokenCharsRatios(): void {
  byModel.clear()
  seenEventIds.clear()
  hydrated = true
  hydratePromise = undefined
}

/**
 * 返回该模型用于估算的「字符数 / token」。
 * 样本不足或未指定模型时回退到 DEFAULT_CHARS_PER_TOKEN。
 */
export function getCharsPerToken(model?: string): number {
  void ensureTokenCharsRatioHydrated()
  if (!model?.trim()) {
    return DEFAULT_CHARS_PER_TOKEN
  }
  const stats = byModel.get(model)
  if (!stats || !hasEnoughData(stats)) {
    return DEFAULT_CHARS_PER_TOKEN
  }
  return stats.totalChars / stats.totalTokens
}

/** 调试 / 设置页用：某模型当前是否已有足够学习数据。 */
export function getTokenCharsRatioStats(model: string): ModelRatioStats | undefined {
  return byModel.get(model)
}
