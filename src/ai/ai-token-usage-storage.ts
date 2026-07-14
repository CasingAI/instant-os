import type { TokenUsageSnapshot } from '../apps/browser/browser-token-usage.ts'
import { osDayKey, osNowMs } from '../os/os-clock.ts'
import {
  AI_TOKEN_USAGE_STORE,
  DATA_CAPACITY_BYTES,
  DATA_META_STORE,
  DATA_STORAGE_CHANGED_EVENT,
  runDataStoreTransaction,
} from '../os/device-data-storage.ts'
import { resolveActorLabel, type AiUsageContext } from './ai-usage-context.ts'
import type {
  ActorTokenUsage,
  AiTokenUsageRecord,
  AiUsageRequestRecord,
  BehaviorTokenUsage,
  DayTokenUsage,
} from './ai-token-usage-types.ts'

const SUMMARY_KEY = '__summary__'
const LEGACY_STORAGE_KEY = 'instant-os-ai-token-usage'

type SummaryDbRecord = {
  key: typeof SUMMARY_KEY
  kind: 'summary'
  byteSize: number
  data: AiTokenUsageRecord
}

type RequestDbRecord = AiUsageRequestRecord & {
  key: string
  kind: 'request'
  byteSize: number
}

type AiUsageDbRecord = SummaryDbRecord | RequestDbRecord

const EMPTY_RECORD: AiTokenUsageRecord = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  byActor: {},
  byDay: {},
}

let initPromise: Promise<void> | undefined

function estimateRecordBytes(record: unknown): number {
  return new TextEncoder().encode(JSON.stringify(record)).length
}

function createRequestId(at: number): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `req:${crypto.randomUUID()}`
  }
  return `req:${at}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeBehavior(
  context: AiUsageContext,
  existing?: BehaviorTokenUsage,
): BehaviorTokenUsage {
  return {
    behavior: context.behavior,
    label: context.behaviorLabel ?? existing?.label ?? context.behavior,
    promptTokens: existing?.promptTokens ?? 0,
    completionTokens: existing?.completionTokens ?? 0,
    totalTokens: existing?.totalTokens ?? 0,
    requestCount: existing?.requestCount ?? 0,
  }
}

function normalizeActor(context: AiUsageContext, existing?: ActorTokenUsage): ActorTokenUsage {
  return {
    actor: context.actor,
    label: context.actorLabel ?? existing?.label ?? resolveActorLabel(context.actor),
    promptTokens: existing?.promptTokens ?? 0,
    completionTokens: existing?.completionTokens ?? 0,
    totalTokens: existing?.totalTokens ?? 0,
    requestCount: existing?.requestCount ?? 0,
    byBehavior: existing?.byBehavior ?? {},
  }
}

function normalizeDay(day: string, existing?: DayTokenUsage): DayTokenUsage {
  return {
    day,
    promptTokens: existing?.promptTokens ?? 0,
    completionTokens: existing?.completionTokens ?? 0,
    totalTokens: existing?.totalTokens ?? 0,
    requestCount: existing?.requestCount ?? 0,
  }
}

function parseLegacyRecord(raw: string | undefined): AiTokenUsageRecord {
  if (!raw) {
    return { ...EMPTY_RECORD, byActor: {}, byDay: {} }
  }

  try {
    const parsed = JSON.parse(raw) as AiTokenUsageRecord
    return {
      totalPromptTokens: parsed.totalPromptTokens ?? 0,
      totalCompletionTokens: parsed.totalCompletionTokens ?? 0,
      totalTokens: parsed.totalTokens ?? 0,
      requestCount: parsed.requestCount ?? 0,
      byActor: parsed.byActor ?? {},
      byDay: parsed.byDay ?? {},
    }
  } catch {
    return { ...EMPTY_RECORD, byActor: {}, byDay: {} }
  }
}

function toSummaryDbRecord(data: AiTokenUsageRecord): SummaryDbRecord {
  const record: SummaryDbRecord = {
    key: SUMMARY_KEY,
    kind: 'summary',
    data,
    byteSize: 0,
  }
  record.byteSize = estimateRecordBytes(record)
  return record
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

async function readSummaryRecord(): Promise<SummaryDbRecord | undefined> {
  try {
    return await runDataStoreTransaction<SummaryDbRecord | undefined>(
      AI_TOKEN_USAGE_STORE,
      'readonly',
      (store) => store.get(SUMMARY_KEY),
    )
  } catch {
    return undefined
  }
}

async function writeSummaryRecord(data: AiTokenUsageRecord): Promise<boolean> {
  const existing = await readSummaryRecord()
  const next = toSummaryDbRecord(data)
  const currentTotal = await readByteTotal()
  const projectedTotal = currentTotal - (existing?.byteSize ?? 0) + next.byteSize

  if (projectedTotal > DATA_CAPACITY_BYTES) {
    return false
  }

  await runDataStoreTransaction(AI_TOKEN_USAGE_STORE, 'readwrite', (store) => store.put(next))
  await writeByteTotal(projectedTotal)
  emitDataStorageChanged()
  return true
}

async function migrateLegacyLocalStorage(): Promise<void> {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) {
      return
    }

    const existing = await readSummaryRecord()
    if (!existing) {
      const legacy = parseLegacyRecord(raw)
      if (legacy.requestCount > 0) {
        await writeSummaryRecord(legacy)
      }
    }

    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // ignore migration errors
  }
}

export async function initAiTokenUsageStorage(): Promise<void> {
  if (!initPromise) {
    initPromise = migrateLegacyLocalStorage()
  }
  await initPromise
}

export async function loadAiTokenUsageFromStore(): Promise<AiTokenUsageRecord> {
  await initAiTokenUsageStorage()
  const summary = await readSummaryRecord()
  return summary?.data ?? { ...EMPTY_RECORD, byActor: {}, byDay: {} }
}

export async function loadAiUsageRequestsForDay(day: string): Promise<AiUsageRequestRecord[]> {
  await initAiTokenUsageStorage()
  try {
    const records = await runDataStoreTransaction<RequestDbRecord[]>(
      AI_TOKEN_USAGE_STORE,
      'readonly',
      (store) => store.index('day').getAll(day),
    )
    return records
      .filter((record): record is RequestDbRecord => record.kind === 'request')
      .map(({ key: _key, kind: _kind, byteSize: _byteSize, ...request }) => request)
      .sort((left, right) => right.at - left.at)
  } catch {
    return []
  }
}

export async function getAiTokenUsageBytes(): Promise<number> {
  try {
    const records = await runDataStoreTransaction<Array<{ byteSize?: number }>>(
      AI_TOKEN_USAGE_STORE,
      'readonly',
      (store) => store.getAll(),
    )
    return records.reduce((total, record) => total + (record.byteSize ?? 0), 0)
  } catch {
    return 0
  }
}

function applyUsageToSummary(
  record: AiTokenUsageRecord,
  context: AiUsageContext,
  usage: TokenUsageSnapshot,
  day: string,
): void {
  record.totalPromptTokens += usage.promptTokens
  record.totalCompletionTokens += usage.completionTokens
  record.totalTokens += usage.totalTokens
  record.requestCount += 1

  const actor = normalizeActor(context, record.byActor[context.actor])
  actor.promptTokens += usage.promptTokens
  actor.completionTokens += usage.completionTokens
  actor.totalTokens += usage.totalTokens
  actor.requestCount += 1

  const behavior = normalizeBehavior(context, actor.byBehavior[context.behavior])
  behavior.promptTokens += usage.promptTokens
  behavior.completionTokens += usage.completionTokens
  behavior.totalTokens += usage.totalTokens
  behavior.requestCount += 1

  actor.byBehavior[context.behavior] = behavior
  record.byActor[context.actor] = actor

  const dayUsage = normalizeDay(day, record.byDay[day])
  dayUsage.promptTokens += usage.promptTokens
  dayUsage.completionTokens += usage.completionTokens
  dayUsage.totalTokens += usage.totalTokens
  dayUsage.requestCount += 1
  record.byDay[day] = dayUsage
}

export async function persistAiTokenUsage(
  context: AiUsageContext,
  usage: TokenUsageSnapshot,
): Promise<AiTokenUsageRecord> {
  await initAiTokenUsageStorage()

  const at = osNowMs()
  const day = osDayKey()
  const actorLabel = context.actorLabel ?? resolveActorLabel(context.actor)
  const behaviorLabel = context.behaviorLabel ?? context.behavior

  const request: AiUsageRequestRecord = {
    id: createRequestId(at),
    day,
    at,
    actor: context.actor,
    behavior: context.behavior,
    actorLabel,
    behaviorLabel,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  }

  const requestDb: RequestDbRecord = {
    key: request.id,
    kind: 'request',
    byteSize: 0,
    ...request,
  }
  requestDb.byteSize = estimateRecordBytes(requestDb)

  const summary = (await readSummaryRecord())?.data ?? { ...EMPTY_RECORD, byActor: {}, byDay: {} }
  applyUsageToSummary(summary, context, usage, day)
  const nextSummary = toSummaryDbRecord(summary)

  const existingSummary = await readSummaryRecord()
  const currentTotal = await readByteTotal()
  const projectedTotal =
    currentTotal -
    (existingSummary?.byteSize ?? 0) +
    nextSummary.byteSize +
    requestDb.byteSize

  if (projectedTotal > DATA_CAPACITY_BYTES) {
    return summary
  }

  await runDataStoreTransaction(AI_TOKEN_USAGE_STORE, 'readwrite', (store) => {
    store.put(requestDb)
    store.put(nextSummary)
    return store.count()
  })
  await writeByteTotal(projectedTotal)
  emitDataStorageChanged()
  return summary
}

export async function clearAiTokenUsageStore(): Promise<void> {
  await initAiTokenUsageStorage()

  try {
    const records = await runDataStoreTransaction<AiUsageDbRecord[]>(
      AI_TOKEN_USAGE_STORE,
      'readonly',
      (store) => store.getAll(),
    )
    if (records.length === 0) {
      return
    }

    const freedBytes = records.reduce((total, record) => total + (record.byteSize ?? 0), 0)
    await runDataStoreTransaction(AI_TOKEN_USAGE_STORE, 'readwrite', (store) => {
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
