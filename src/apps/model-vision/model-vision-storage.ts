import { osNowMs } from '../../os/os-clock.ts'
import {
  DATA_META_STORE,
  DATA_STORAGE_CHANGED_EVENT,
  DeviceDataStorageFullError,
  MODEL_VISION_MEDIA_STORE,
  MODEL_VISION_RESULTS_STORE,
  rebuildDataByteTotal,
  runDataStoreTransaction,
  wouldExceedDataCapacity,
} from '../../os/device-data-storage.ts'
import {
  MODEL_VISION_CHANGED_EVENT,
  type ModelVisionOrientation,
  type ModelVisionResultRecord,
  type ModelVisionResultSummary,
  type ModelVisionViewPreview,
} from './model-vision-types.ts'

type ModelVisionTextRecord = {
  modelId: string
  label: string
  source: string
  url: string
  analyzedAt: number
  providerId: string
  model: string
  visualDescription: string
  appearanceNotes: string
  orientation: ModelVisionOrientation
  rawText: string
  byteSize: number
  error?: string
  hasMedia?: boolean
}

type ModelVisionMediaRecord = {
  modelId: string
  viewPreviews?: ModelVisionViewPreview[]
  thumbnailDataUrl?: string
  byteSize: number
}

/** 拆分媒体字段前，文本与预览曾写在同一条结果记录里 */
type LegacyModelVisionFatRecord = ModelVisionTextRecord & {
  viewPreviews?: ModelVisionViewPreview[]
  thumbnailDataUrl?: string
}

function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
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

function emitChanged(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent(MODEL_VISION_CHANGED_EVENT))
  window.dispatchEvent(new CustomEvent(DATA_STORAGE_CHANGED_EVENT))
}

function isValidOrientation(value: unknown): value is ModelVisionOrientation {
  return value !== undefined && typeof value === 'object'
}

function isValidTextRecord(value: unknown): value is ModelVisionTextRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Partial<ModelVisionTextRecord>
  return (
    typeof record.modelId === 'string' &&
    typeof record.label === 'string' &&
    typeof record.analyzedAt === 'number' &&
    typeof record.visualDescription === 'string' &&
    typeof record.rawText === 'string' &&
    isValidOrientation(record.orientation)
  )
}

function toSummary(record: ModelVisionTextRecord): ModelVisionResultSummary {
  return {
    modelId: record.modelId,
    label: record.label,
    source: record.source,
    url: record.url,
    analyzedAt: record.analyzedAt,
    providerId: record.providerId,
    model: record.model,
    visualDescription: record.visualDescription,
    appearanceNotes: record.appearanceNotes,
    orientation: record.orientation,
    byteSize: record.byteSize,
    error: record.error,
    hasViewPreviews: record.hasMedia === true,
  }
}

async function getRawResultRecord(modelId: string): Promise<unknown> {
  try {
    return await runDataStoreTransaction<unknown>(
      MODEL_VISION_RESULTS_STORE,
      'readonly',
      (store) => store.get(modelId),
    )
  } catch {
    return undefined
  }
}

function readEmbeddedMedia(raw: unknown): {
  viewPreviews?: ModelVisionViewPreview[]
  thumbnailDataUrl?: string
} {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const record = raw as Partial<ModelVisionResultRecord>
  const viewPreviews =
    Array.isArray(record.viewPreviews) && record.viewPreviews.length > 0
      ? (record.viewPreviews as ModelVisionViewPreview[])
      : undefined
  const thumbnailDataUrl =
    typeof record.thumbnailDataUrl === 'string' &&
    record.thumbnailDataUrl.startsWith('data:image/')
      ? record.thumbnailDataUrl
      : undefined
  return { viewPreviews, thumbnailDataUrl }
}

async function getTextRecord(modelId: string): Promise<ModelVisionTextRecord | undefined> {
  try {
    const record = await getRawResultRecord(modelId)
    if (!isValidTextRecord(record)) {
      return undefined
    }
    const embedded = readEmbeddedMedia(record)
    return {
      modelId: record.modelId,
      label: record.label,
      source: record.source,
      url: record.url,
      analyzedAt: record.analyzedAt,
      providerId: record.providerId,
      model: record.model,
      visualDescription: record.visualDescription,
      appearanceNotes: record.appearanceNotes,
      orientation: record.orientation,
      rawText: record.rawText,
      byteSize: record.byteSize,
      error: record.error,
      hasMedia:
        record.hasMedia === true ||
        Boolean(embedded.viewPreviews) ||
        Boolean(embedded.thumbnailDataUrl),
    }
  } catch {
    return undefined
  }
}

async function getMediaRecord(modelId: string): Promise<ModelVisionMediaRecord | undefined> {
  try {
    const record = await runDataStoreTransaction<ModelVisionMediaRecord | undefined>(
      MODEL_VISION_MEDIA_STORE,
      'readonly',
      (store) => store.get(modelId),
    )
    if (!record || typeof record.modelId !== 'string') {
      return undefined
    }
    return record
  } catch {
    return undefined
  }
}

export async function getModelVisionResult(
  modelId: string,
): Promise<ModelVisionResultRecord | undefined> {
  const raw = await getRawResultRecord(modelId)
  if (!isValidTextRecord(raw)) {
    return undefined
  }
  const embedded = readEmbeddedMedia(raw)
  const media = await getMediaRecord(modelId)
  const viewPreviews =
    media?.viewPreviews && media.viewPreviews.length > 0
      ? media.viewPreviews
      : embedded.viewPreviews
  const thumbnailDataUrl = media?.thumbnailDataUrl ?? embedded.thumbnailDataUrl
  return {
    modelId: raw.modelId,
    label: raw.label,
    source: raw.source,
    url: raw.url,
    analyzedAt: raw.analyzedAt,
    providerId: raw.providerId,
    model: raw.model,
    visualDescription: raw.visualDescription,
    appearanceNotes: raw.appearanceNotes,
    orientation: raw.orientation,
    rawText: raw.rawText,
    byteSize: raw.byteSize,
    error: raw.error,
    viewPreviews,
    thumbnailDataUrl,
  }
}

export async function getModelVisionSummaryMap(): Promise<
  Map<string, ModelVisionResultSummary>
> {
  try {
    const summaries = await runDataStoreTransaction(
      MODEL_VISION_RESULTS_STORE,
      'readonly',
      (store) =>
        new Promise<ModelVisionResultSummary[]>((resolve, reject) => {
          const request = store.openCursor()
          const next: ModelVisionResultSummary[] = []
          request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) {
              resolve(next)
              return
            }
            const value = cursor.value as unknown
            if (isValidTextRecord(value)) {
              // 只拷文字字段，避免旧版内嵌 dataURL 进入 Map
              next.push(
                toSummary({
                  modelId: value.modelId,
                  label: value.label,
                  source: value.source,
                  url: value.url,
                  analyzedAt: value.analyzedAt,
                  providerId: value.providerId,
                  model: value.model,
                  visualDescription: value.visualDescription,
                  appearanceNotes: value.appearanceNotes,
                  orientation: value.orientation,
                  rawText: value.rawText,
                  byteSize: value.byteSize,
                  error: value.error,
                  hasMedia:
                    value.hasMedia === true ||
                    (Array.isArray((value as { viewPreviews?: unknown }).viewPreviews) &&
                      ((value as { viewPreviews?: unknown[] }).viewPreviews?.length ?? 0) > 0),
                }),
              )
            }
            cursor.continue()
          }
          request.onerror = () => reject(request.error ?? new Error('读取识图摘要失败'))
        }),
    )
    return new Map(summaries.map((summary) => [summary.modelId, summary]))
  } catch {
    return new Map()
  }
}

export type PutModelVisionOptions = {
  /** 批量时静默写入，避免每次触发整表摘要重载 */
  silent?: boolean
  /** 批量时可不落盘预览图 */
  skipMedia?: boolean
}

export async function putModelVisionResult(
  input: Omit<ModelVisionResultRecord, 'byteSize' | 'analyzedAt'> & {
    analyzedAt?: number
  },
  options: PutModelVisionOptions = {},
): Promise<ModelVisionResultRecord> {
  const existingText = await getTextRecord(input.modelId)
  const existingMedia = await getMediaRecord(input.modelId)

  const wantMedia =
    !options.skipMedia &&
    Boolean((input.viewPreviews && input.viewPreviews.length > 0) || input.thumbnailDataUrl)

  const textWithoutSize: Omit<ModelVisionTextRecord, 'byteSize'> = {
    modelId: input.modelId,
    label: input.label,
    source: input.source,
    url: input.url,
    analyzedAt: input.analyzedAt ?? osNowMs(),
    providerId: input.providerId,
    model: input.model,
    visualDescription: input.visualDescription,
    appearanceNotes: input.appearanceNotes,
    orientation: input.orientation,
    rawText: input.rawText,
    error: input.error,
    hasMedia: wantMedia,
  }
  const textByteSize = estimateJsonBytes(textWithoutSize)
  const textRecord: ModelVisionTextRecord = { ...textWithoutSize, byteSize: textByteSize }

  let mediaRecord: ModelVisionMediaRecord | undefined
  if (wantMedia) {
    const mediaWithoutSize = {
      modelId: input.modelId,
      viewPreviews: input.viewPreviews,
      thumbnailDataUrl: input.thumbnailDataUrl,
    }
    mediaRecord = {
      ...mediaWithoutSize,
      byteSize: estimateJsonBytes(mediaWithoutSize),
    }
  }

  const currentTotal = await readByteTotal()
  const projectedTotal =
    currentTotal -
    (existingText?.byteSize ?? 0) -
    (existingMedia?.byteSize ?? 0) +
    textByteSize +
    (mediaRecord?.byteSize ?? 0)

  if (await wouldExceedDataCapacity(projectedTotal)) {
    throw new DeviceDataStorageFullError()
  }

  await runDataStoreTransaction(MODEL_VISION_RESULTS_STORE, 'readwrite', (store) =>
    store.put(textRecord),
  )

  if (mediaRecord) {
    await runDataStoreTransaction(MODEL_VISION_MEDIA_STORE, 'readwrite', (store) =>
      store.put(mediaRecord),
    )
  } else if (existingMedia) {
    await runDataStoreTransaction(MODEL_VISION_MEDIA_STORE, 'readwrite', (store) =>
      store.delete(input.modelId),
    )
  }

  await writeByteTotal(projectedTotal)
  // 批量 silent：完全不广播，避免设置页/用量监听在每条结果上扫库
  if (!options.silent) {
    emitChanged()
  }

  return {
    ...textRecord,
    viewPreviews: mediaRecord?.viewPreviews,
    thumbnailDataUrl: mediaRecord?.thumbnailDataUrl,
  }
}

export async function deleteModelVisionResult(modelId: string): Promise<void> {
  const existingText = await getTextRecord(modelId)
  const existingMedia = await getMediaRecord(modelId)
  if (!existingText && !existingMedia) {
    return
  }
  await runDataStoreTransaction(MODEL_VISION_RESULTS_STORE, 'readwrite', (store) =>
    store.delete(modelId),
  )
  await runDataStoreTransaction(MODEL_VISION_MEDIA_STORE, 'readwrite', (store) =>
    store.delete(modelId),
  )
  const currentTotal = await readByteTotal()
  const freed = (existingText?.byteSize ?? 0) + (existingMedia?.byteSize ?? 0)
  await writeByteTotal(Math.max(0, currentTotal - freed))
  emitChanged()
}

export async function clearModelVisionResults(): Promise<void> {
  const [textBytes, mediaBytes] = await Promise.all([
    sumStoreByteSize(MODEL_VISION_RESULTS_STORE),
    sumStoreByteSize(MODEL_VISION_MEDIA_STORE),
  ])
  await runDataStoreTransaction(MODEL_VISION_RESULTS_STORE, 'readwrite', (store) => {
    store.clear()
    return store.count()
  })
  await runDataStoreTransaction(MODEL_VISION_MEDIA_STORE, 'readwrite', (store) => {
    store.clear()
    return store.count()
  })
  const currentTotal = await readByteTotal()
  await writeByteTotal(Math.max(0, currentTotal - textBytes - mediaBytes))
  emitChanged()
}

async function sumStoreByteSize(storeName: string): Promise<number> {
  try {
    return await runDataStoreTransaction(storeName, 'readonly', (store) => {
      return new Promise<number>((resolve, reject) => {
        const request = store.openCursor()
        let total = 0
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve(total)
            return
          }
          const record = cursor.value as { byteSize?: number }
          total += record.byteSize ?? 0
          cursor.continue()
        }
        request.onerror = () => reject(request.error ?? new Error('统计占用失败'))
      })
    })
  } catch {
    return 0
  }
}

export async function getModelVisionStorageBytes(): Promise<number> {
  const [textBytes, mediaBytes] = await Promise.all([
    sumStoreByteSize(MODEL_VISION_RESULTS_STORE),
    sumStoreByteSize(MODEL_VISION_MEDIA_STORE),
  ])
  return textBytes + mediaBytes
}

/** 一次性把旧版内嵌大图拆到 media store，避免摘要扫描时反复反序列化巨图。 */
export async function migrateModelVisionEmbeddedMedia(): Promise<number> {
  let migrated = 0
  try {
    const fatIds: string[] = []
    await runDataStoreTransaction(MODEL_VISION_RESULTS_STORE, 'readonly', (store) => {
      return new Promise<void>((resolve, reject) => {
        const request = store.openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve()
            return
          }
          const value = cursor.value as Partial<ModelVisionResultRecord>
          const hasViews = Array.isArray(value.viewPreviews) && value.viewPreviews.length > 0
          const hasThumb =
            typeof value.thumbnailDataUrl === 'string' &&
            value.thumbnailDataUrl.startsWith('data:image/')
          if (typeof value.modelId === 'string' && (hasViews || hasThumb)) {
            fatIds.push(value.modelId)
          }
          cursor.continue()
        }
        request.onerror = () => reject(request.error ?? new Error('迁移扫描失败'))
      })
    })

    for (const modelId of fatIds) {
      const raw = await runDataStoreTransaction<Partial<ModelVisionResultRecord> | undefined>(
        MODEL_VISION_RESULTS_STORE,
        'readonly',
        (store) => store.get(modelId),
      )
      if (!raw || !isValidTextRecord(raw)) continue
      const legacy = raw as LegacyModelVisionFatRecord

      const existingMedia = await getMediaRecord(modelId)
      if (
        !existingMedia &&
        ((Array.isArray(legacy.viewPreviews) && legacy.viewPreviews.length > 0) ||
          legacy.thumbnailDataUrl)
      ) {
        const mediaWithoutSize = {
          modelId,
          viewPreviews: legacy.viewPreviews,
          thumbnailDataUrl: legacy.thumbnailDataUrl,
        }
        const mediaRecord: ModelVisionMediaRecord = {
          ...mediaWithoutSize,
          byteSize: estimateJsonBytes(mediaWithoutSize),
        }
        await runDataStoreTransaction(MODEL_VISION_MEDIA_STORE, 'readwrite', (store) =>
          store.put(mediaRecord),
        )
      }

      const textWithoutSize: Omit<ModelVisionTextRecord, 'byteSize'> = {
        modelId: raw.modelId,
        label: raw.label,
        source: raw.source,
        url: raw.url,
        analyzedAt: raw.analyzedAt,
        providerId: raw.providerId,
        model: raw.model,
        visualDescription: raw.visualDescription,
        appearanceNotes: raw.appearanceNotes,
        orientation: raw.orientation,
        rawText: raw.rawText,
        error: raw.error,
        hasMedia: true,
      }
      const textRecord: ModelVisionTextRecord = {
        ...textWithoutSize,
        byteSize: estimateJsonBytes(textWithoutSize),
      }
      await runDataStoreTransaction(MODEL_VISION_RESULTS_STORE, 'readwrite', (store) =>
        store.put(textRecord),
      )
      migrated += 1
    }

    if (migrated > 0) {
      await rebuildDataByteTotal()
      emitChanged()
    }
  } catch {
    // ignore
  }
  return migrated
}

/** 导出用：全部文字结果（不含预览图 dataURL，避免文件过大）。 */
export async function listAllModelVisionExportRecords(): Promise<
  Array<Omit<ModelVisionResultRecord, 'viewPreviews' | 'thumbnailDataUrl' | 'byteSize'>>
> {
  try {
    const records = await runDataStoreTransaction(
      MODEL_VISION_RESULTS_STORE,
      'readonly',
      (store) =>
        new Promise<
          Array<Omit<ModelVisionResultRecord, 'viewPreviews' | 'thumbnailDataUrl' | 'byteSize'>>
        >((resolve, reject) => {
          const request = store.openCursor()
          const next: Array<
            Omit<ModelVisionResultRecord, 'viewPreviews' | 'thumbnailDataUrl' | 'byteSize'>
          > = []
          request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) {
              resolve(next)
              return
            }
            const value = cursor.value as unknown
            if (isValidTextRecord(value)) {
              next.push({
                modelId: value.modelId,
                label: value.label,
                source: value.source,
                url: value.url,
                analyzedAt: value.analyzedAt,
                providerId: value.providerId,
                model: value.model,
                visualDescription: value.visualDescription,
                appearanceNotes: value.appearanceNotes ?? '',
                orientation: value.orientation,
                rawText: value.rawText,
                error: value.error,
              })
            }
            cursor.continue()
          }
          request.onerror = () => reject(request.error ?? new Error('读取识图结果失败'))
        }),
    )
    return records.sort((left, right) => left.modelId.localeCompare(right.modelId))
  } catch {
    return []
  }
}
