import { osDayKey, osNowMs } from '../os/os-clock.ts'
import {
  AI_EVENT_LOG_STORE,
  DATA_META_STORE,
  DATA_STORAGE_CHANGED_EVENT,
  runDataStoreTransaction,
  wouldExceedDataCapacity,
} from '../os/device-data-storage.ts'
import { resolveEventLogPerformance } from './ai-event-log-timing.ts'
import { resolveActorLabel, type AiUsageContext } from './ai-usage-context.ts'
import type { AiEventLogInput, AiEventLogRecord } from './ai-event-log-types.ts'

type AiEventLogDbRecord = AiEventLogRecord & {
  key: string
  byteSize: number
}

function estimateRecordBytes(record: unknown): number {
  return new TextEncoder().encode(JSON.stringify(record)).length
}

function createEventId(at: number): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `evt:${crypto.randomUUID()}`
  }
  return `evt:${at}-${Math.random().toString(36).slice(2, 10)}`
}

async function readByteTotal(): Promise<number> {
  try {
    const meta = await runDataStoreTransaction<{ totalBytes?: number } | undefined>(
      DATA_META_STORE,
      'readonly',
      (store) => store.get('byte-total'),
    )
    return meta?.totalBytes ?? 0
  } catch {
    return 0
  }
}

async function writeByteTotal(totalBytes: number): Promise<void> {
  await runDataStoreTransaction(DATA_META_STORE, 'readwrite', (store) =>
    store.put({ key: 'byte-total', totalBytes }),
  )
}

function emitDataStorageChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_STORAGE_CHANGED_EVENT))
  }
}

function toDbRecord(
  context: AiUsageContext,
  input: AiEventLogInput,
  at: number,
  realAt: number,
  day: string,
): AiEventLogDbRecord {
  const performance = resolveEventLogPerformance(input.timing, input.usage, input.response)
  const record: AiEventLogDbRecord = {
    key: '',
    id: '',
    day,
    at,
    realAt,
    actor: context.actor,
    behavior: context.behavior,
    actorLabel: context.actorLabel ?? resolveActorLabel(context.actor),
    behaviorLabel: context.behaviorLabel ?? context.behavior,
    model: input.model,
    thinkingEnabled: input.thinkingEnabled,
    messages: input.messages,
    response: input.response,
    promptTokens: input.usage?.promptTokens,
    completionTokens: input.usage?.completionTokens,
    cachedPromptTokens: input.usage?.cachedPromptTokens,
    totalTokens: input.usage?.totalTokens,
    usageEstimated: input.usageEstimated,
    status: input.status ?? 'success',
    errorMessage: input.errorMessage,
    startedAt: performance.startedAt,
    startedRealAt: performance.startedRealAt,
    firstTokenAt: performance.firstTokenAt,
    firstTokenRealAt: performance.firstTokenRealAt,
    durationMs: performance.durationMs,
    timeToFirstTokenMs: performance.timeToFirstTokenMs,
    completionTokensPerSecond: performance.completionTokensPerSecond,
    responseCharCount: performance.responseCharCount,
    responseCharsPerSecond: performance.responseCharsPerSecond,
    byteSize: 0,
  }
  record.id = input.id ?? createEventId(at)
  record.key = record.id
  record.byteSize = estimateRecordBytes(record)
  return record
}

export async function persistAiEventLog(
  context: AiUsageContext,
  input: AiEventLogInput,
): Promise<AiEventLogRecord | undefined> {
  const at = input.timing?.endedAt ?? osNowMs()
  const realAt = input.timing?.endedRealAt ?? Date.now()
  const day = osDayKey()

  let previousByteSize = 0
  const recordId = input.id
  if (recordId) {
    try {
      const existing = await runDataStoreTransaction<AiEventLogDbRecord | undefined>(
        AI_EVENT_LOG_STORE,
        'readonly',
        (store) => store.get(recordId),
      )
      previousByteSize = existing?.byteSize ?? 0
    } catch {
      previousByteSize = 0
    }
  }

  const dbRecord = toDbRecord(context, input, at, realAt, day)
  const currentTotal = await readByteTotal()
  const projectedTotal = currentTotal - previousByteSize + dbRecord.byteSize

  if (await wouldExceedDataCapacity(projectedTotal)) {
    return undefined
  }

  await runDataStoreTransaction(AI_EVENT_LOG_STORE, 'readwrite', (store) => store.put(dbRecord))
  await writeByteTotal(Math.max(0, projectedTotal))
  emitDataStorageChanged()

  const { key: _key, byteSize: _byteSize, ...record } = dbRecord
  return record
}

export async function loadRecentAiEventLogs(limit: number): Promise<AiEventLogRecord[]> {
  if (limit <= 0) {
    return []
  }

  try {
    const records = await runDataStoreTransaction<AiEventLogDbRecord[]>(
      AI_EVENT_LOG_STORE,
      'readonly',
      (store) => store.getAll(),
    )
    return records
      .map(({ key: _key, byteSize: _byteSize, ...record }) => record)
      .sort((left, right) => right.at - left.at)
      .slice(0, limit)
  } catch {
    return []
  }
}

export async function loadAiEventLogsForDay(day: string): Promise<AiEventLogRecord[]> {
  try {
    const records = await runDataStoreTransaction<AiEventLogDbRecord[]>(
      AI_EVENT_LOG_STORE,
      'readonly',
      (store) => store.index('day').getAll(day),
    )
    return records
      .map(({ key: _key, byteSize: _byteSize, ...record }) => record)
      .sort((left, right) => right.at - left.at)
  } catch {
    return []
  }
}

export async function getAiEventLogBytes(): Promise<number> {
  try {
    const records = await runDataStoreTransaction<Array<{ byteSize?: number }>>(
      AI_EVENT_LOG_STORE,
      'readonly',
      (store) => store.getAll(),
    )
    return records.reduce((total, record) => total + (record.byteSize ?? 0), 0)
  } catch {
    return 0
  }
}

export async function deleteAiEventLogById(id: string): Promise<boolean> {
  try {
    const record = await runDataStoreTransaction<AiEventLogDbRecord | undefined>(
      AI_EVENT_LOG_STORE,
      'readonly',
      (store) => store.get(id),
    )
    if (!record) {
      return false
    }

    await runDataStoreTransaction(AI_EVENT_LOG_STORE, 'readwrite', (store) => {
      store.delete(record.key)
      return store.count()
    })

    const currentTotal = await readByteTotal()
    await writeByteTotal(Math.max(0, currentTotal - (record.byteSize ?? 0)))
    emitDataStorageChanged()
    return true
  } catch {
    return false
  }
}

export async function clearAiEventLogStore(): Promise<void> {
  try {
    const records = await runDataStoreTransaction<AiEventLogDbRecord[]>(
      AI_EVENT_LOG_STORE,
      'readonly',
      (store) => store.getAll(),
    )
    if (records.length === 0) {
      return
    }

    const freedBytes = records.reduce((total, record) => total + (record.byteSize ?? 0), 0)
    await runDataStoreTransaction(AI_EVENT_LOG_STORE, 'readwrite', (store) => {
      for (const record of records) {
        store.delete(record.key)
      }
      return store.count()
    })

    const currentTotal = await readByteTotal()
    await writeByteTotal(Math.max(0, currentTotal - freedBytes))
    emitDataStorageChanged()
  } catch {
    // ignore
  }
}
