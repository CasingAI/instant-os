import { formatStorageSize } from './format-storage-size.ts'
import { osNowMs } from './os-clock.ts'
/** IndexedDB 数据空间硬上限 1 GB */
export const DATA_CAPACITY_BYTES = 1024 * 1024 * 1024

export const DATA_STORAGE_CHANGED_EVENT = 'instant-os:data-storage-changed'

export const DATA_DB_NAME = 'instant-os-data'
export const DATA_DB_VERSION = 8
export const BOOK_CHAPTERS_STORE = 'book-chapters'
export const BOOK_DETAILS_STORE = 'book-details'
export const SAFARI_PAGE_CACHE_STORE = 'safari-page-cache'
export const AI_TOKEN_USAGE_STORE = 'ai-token-usage'
export const AI_EVENT_LOG_STORE = 'ai-event-log'
export const FOLDER_ICON_SNAPSHOTS_STORE = 'folder-icon-snapshots'
export const MODEL_VISION_RESULTS_STORE = 'model-vision-results'
export const MODEL_VISION_MEDIA_STORE = 'model-vision-media'
export const DATA_META_STORE = 'data-meta'

export type BookChapterRecord = {
  key: string
  bookId: string
  chapterId: string
  index: number
  title: string
  body: string
  byteSize: number
}

export type BookDetailRecord = {
  slug: string
  tagline: string
  longSynopsis: string
  chapterOutline: string[]
  byteSize: number
  updatedAt: number
}

export type SafariPageCacheRecord = {
  url: string
  hostname: string
  title: string
  html: string
  pageTokens: number | undefined
  cachedAt: number
  byteSize: number
}

type DataMetaRecord = {
  key: 'byte-total'
  totalBytes: number
}

export class DeviceDataStorageFullError extends Error {
  constructor() {
    super(`数据空间已满（${formatStorageSize(DATA_CAPACITY_BYTES)} 上限）`)
    this.name = 'DeviceDataStorageFullError'
  }
}

function chapterKey(bookId: string, chapterId: string): string {
  return `${bookId}:${chapterId}`
}

function estimateRecordBytes(record: Omit<BookChapterRecord, 'key' | 'byteSize'>): number {
  return new TextEncoder().encode(
    JSON.stringify({
      bookId: record.bookId,
      chapterId: record.chapterId,
      index: record.index,
      title: record.title,
      body: record.body,
    }),
  ).length
}

function estimateBookDetailBytes(record: Omit<BookDetailRecord, 'byteSize' | 'updatedAt'>): number {
  return new TextEncoder().encode(
    JSON.stringify({
      slug: record.slug,
      tagline: record.tagline,
      longSynopsis: record.longSynopsis,
      chapterOutline: record.chapterOutline,
    }),
  ).length
}

function estimateSafariPageCacheBytes(
  record: Omit<SafariPageCacheRecord, 'byteSize'>,
): number {
  return new TextEncoder().encode(
    JSON.stringify({
      url: record.url,
      hostname: record.hostname,
      title: record.title,
      html: record.html,
      pageTokens: record.pageTokens,
      cachedAt: record.cachedAt,
    }),
  ).length
}

let dbPromise: Promise<IDBDatabase> | undefined

function openDataDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATA_DB_NAME, DATA_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(BOOK_CHAPTERS_STORE)) {
        const store = db.createObjectStore(BOOK_CHAPTERS_STORE, { keyPath: 'key' })
        store.createIndex('bookId', 'bookId', { unique: false })
      }
      if (!db.objectStoreNames.contains(DATA_META_STORE)) {
        db.createObjectStore(DATA_META_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(BOOK_DETAILS_STORE)) {
        db.createObjectStore(BOOK_DETAILS_STORE, { keyPath: 'slug' })
      }
      if (!db.objectStoreNames.contains(SAFARI_PAGE_CACHE_STORE)) {
        const store = db.createObjectStore(SAFARI_PAGE_CACHE_STORE, { keyPath: 'url' })
        store.createIndex('hostname', 'hostname', { unique: false })
      }
      if (!db.objectStoreNames.contains(AI_TOKEN_USAGE_STORE)) {
        const store = db.createObjectStore(AI_TOKEN_USAGE_STORE, { keyPath: 'key' })
        store.createIndex('day', 'day', { unique: false })
        store.createIndex('kind', 'kind', { unique: false })
      }
      if (!db.objectStoreNames.contains(AI_EVENT_LOG_STORE)) {
        const store = db.createObjectStore(AI_EVENT_LOG_STORE, { keyPath: 'key' })
        store.createIndex('day', 'day', { unique: false })
        store.createIndex('at', 'at', { unique: false })
        store.createIndex('actor', 'actor', { unique: false })
      }
      if (!db.objectStoreNames.contains(FOLDER_ICON_SNAPSHOTS_STORE)) {
        db.createObjectStore(FOLDER_ICON_SNAPSHOTS_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(MODEL_VISION_RESULTS_STORE)) {
        db.createObjectStore(MODEL_VISION_RESULTS_STORE, { keyPath: 'modelId' })
      }
      if (!db.objectStoreNames.contains(MODEL_VISION_MEDIA_STORE)) {
        db.createObjectStore(MODEL_VISION_MEDIA_STORE, { keyPath: 'modelId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = undefined
      reject(request.error ?? new Error('无法打开 IndexedDB'))
    }
  })

  return dbPromise
}

export function runDataStoreTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDataDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        const result = fn(store)

        if (result instanceof Promise) {
          result.then(resolve).catch(reject)
          tx.oncomplete = () => undefined
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
          return
        }

        result.onsuccess = () => resolve(result.result as T)
        result.onerror = () => reject(result.error ?? new Error('IndexedDB 操作失败'))
      }),
  )
}

async function readByteTotal(): Promise<number> {
  try {
    const meta = await runDataStoreTransaction<DataMetaRecord | undefined>(
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
    store.put({ key: 'byte-total', totalBytes } satisfies DataMetaRecord),
  )
}

function emitDataStorageChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_STORAGE_CHANGED_EVENT))
  }
}

export async function getTotalDataStorageBytes(): Promise<number> {
  return readByteTotal()
}

async function getFilesBytesForQuota(): Promise<number> {
  try {
    const { getFilesTotalBytes } = await import('../apps/files/files-storage.ts')
    return await getFilesTotalBytes()
  } catch {
    return 0
  }
}

/** 数据空间已用（核心 IndexedDB）+ 文件用户数据。 */
export async function getCombinedDataStorageBytes(): Promise<number> {
  const [dataBytes, filesBytes] = await Promise.all([
    getTotalDataStorageBytes(),
    getFilesBytesForQuota(),
  ])
  return dataBytes + filesBytes
}

/** 核心数据写入后的 projectedTotal（不含文件）是否会使合并数据空间超限。 */
export async function wouldExceedDataCapacity(projectedCoreDataTotal: number): Promise<boolean> {
  const filesBytes = await getFilesBytesForQuota()
  return projectedCoreDataTotal + filesBytes > DATA_CAPACITY_BYTES
}

async function sumStoreBytes(storeName: string): Promise<number> {
  const records = await runDataStoreTransaction<Array<{ byteSize?: number }>>(
    storeName,
    'readonly',
    (store) => store.getAll(),
  )
  return records.reduce((total, record) => total + (record.byteSize ?? 0), 0)
}

export async function getBookChaptersBytes(bookId?: string): Promise<number> {
  try {
    if (!bookId) {
      return sumStoreBytes(BOOK_CHAPTERS_STORE)
    }

    const records = await runDataStoreTransaction<BookChapterRecord[]>(
      BOOK_CHAPTERS_STORE,
      'readonly',
      (store) => {
        const index = store.index('bookId')
        return index.getAll(bookId)
      },
    )
    return records.reduce((total, record) => total + (record.byteSize ?? 0), 0)
  } catch {
    return 0
  }
}

export async function getBookDetailsBytes(): Promise<number> {
  try {
    return sumStoreBytes(BOOK_DETAILS_STORE)
  } catch {
    return 0
  }
}

export async function getBooksContentBytes(): Promise<number> {
  const [chaptersBytes, detailsBytes] = await Promise.all([
    getBookChaptersBytes(),
    getBookDetailsBytes(),
  ])
  return chaptersBytes + detailsBytes
}

export async function getBookDetailRecord(slug: string): Promise<BookDetailRecord | undefined> {
  try {
    return await runDataStoreTransaction<BookDetailRecord | undefined>(
      BOOK_DETAILS_STORE,
      'readonly',
      (store) => store.get(slug),
    )
  } catch {
    return undefined
  }
}

export async function putBookDetailRecord(input: {
  slug: string
  tagline?: string
  longSynopsis?: string
  chapterOutline?: string[]
}): Promise<boolean> {
  const existing = await getBookDetailRecord(input.slug)
  const record: Omit<BookDetailRecord, 'byteSize' | 'updatedAt'> = {
    slug: input.slug,
    tagline: input.tagline ?? existing?.tagline ?? '',
    longSynopsis: input.longSynopsis ?? existing?.longSynopsis ?? '',
    chapterOutline: input.chapterOutline ?? existing?.chapterOutline ?? [],
  }
  const byteSize = estimateBookDetailBytes(record)
  const currentTotal = await readByteTotal()
  const projectedTotal = currentTotal - (existing?.byteSize ?? 0) + byteSize

  if (await wouldExceedDataCapacity(projectedTotal)) {
    return false
  }

  const saved: BookDetailRecord = {
    ...record,
    byteSize,
    updatedAt: osNowMs(),
  }

  await runDataStoreTransaction(BOOK_DETAILS_STORE, 'readwrite', (store) => store.put(saved))
  await writeByteTotal(projectedTotal)
  emitDataStorageChanged()
  return true
}

export async function deleteBookDetailRecord(slug: string): Promise<void> {
  try {
    const existing = await getBookDetailRecord(slug)
    if (!existing) {
      return
    }

    await runDataStoreTransaction(BOOK_DETAILS_STORE, 'readwrite', (store) => store.delete(slug))
    const currentTotal = await readByteTotal()
    await writeByteTotal(Math.max(0, currentTotal - existing.byteSize))
    emitDataStorageChanged()
  } catch {
    // ignore
  }
}

export async function getSafariPageCacheBytes(): Promise<number> {
  try {
    return sumStoreBytes(SAFARI_PAGE_CACHE_STORE)
  } catch {
    return 0
  }
}

export async function getAllSafariPageCacheRecords(): Promise<SafariPageCacheRecord[]> {
  try {
    return await runDataStoreTransaction<SafariPageCacheRecord[]>(
      SAFARI_PAGE_CACHE_STORE,
      'readonly',
      (store) => store.getAll(),
    )
  } catch {
    return []
  }
}

export async function getSafariPageCacheRecord(
  url: string,
): Promise<SafariPageCacheRecord | undefined> {
  try {
    return await runDataStoreTransaction<SafariPageCacheRecord | undefined>(
      SAFARI_PAGE_CACHE_STORE,
      'readonly',
      (store) => store.get(url),
    )
  } catch {
    return undefined
  }
}

export async function putSafariPageCacheRecord(input: {
  url: string
  hostname: string
  title: string
  html: string
  pageTokens: number | undefined
  cachedAt: number
}): Promise<boolean> {
  const byteSize = estimateSafariPageCacheBytes(input)
  const existing = await getSafariPageCacheRecord(input.url)
  const currentTotal = await readByteTotal()
  const projectedTotal = currentTotal - (existing?.byteSize ?? 0) + byteSize

  if (await wouldExceedDataCapacity(projectedTotal)) {
    return false
  }

  const record: SafariPageCacheRecord = { ...input, byteSize }

  await runDataStoreTransaction(SAFARI_PAGE_CACHE_STORE, 'readwrite', (store) => store.put(record))
  await writeByteTotal(projectedTotal)
  emitDataStorageChanged()
  return true
}

export async function deleteSafariPageCacheRecord(url: string): Promise<void> {
  try {
    const existing = await getSafariPageCacheRecord(url)
    if (!existing) {
      return
    }

    await runDataStoreTransaction(SAFARI_PAGE_CACHE_STORE, 'readwrite', (store) => store.delete(url))
    const currentTotal = await readByteTotal()
    await writeByteTotal(Math.max(0, currentTotal - existing.byteSize))
    emitDataStorageChanged()
  } catch {
    // ignore
  }
}

export async function clearAllSafariPageCache(): Promise<void> {
  try {
    const records = await getAllSafariPageCacheRecords()
    if (records.length === 0) {
      return
    }

    const freedBytes = records.reduce((total, record) => total + record.byteSize, 0)
    await runDataStoreTransaction(SAFARI_PAGE_CACHE_STORE, 'readwrite', (store) => {
      for (const record of records) {
        store.delete(record.url)
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

export async function clearSafariPageCacheByHostname(hostname: string): Promise<void> {
  const normalizedHost = hostname.replace(/^www\./, '')
  try {
    const records = await runDataStoreTransaction<SafariPageCacheRecord[]>(
      SAFARI_PAGE_CACHE_STORE,
      'readonly',
      (store) => store.index('hostname').getAll(normalizedHost),
    )
    if (records.length === 0) {
      return
    }

    const freedBytes = records.reduce((total, record) => total + record.byteSize, 0)
    await runDataStoreTransaction(SAFARI_PAGE_CACHE_STORE, 'readwrite', (store) => {
      for (const record of records) {
        store.delete(record.url)
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

export async function getBookChapter(
  bookId: string,
  chapterId: string,
): Promise<BookChapterRecord | undefined> {
  try {
    return await runDataStoreTransaction<BookChapterRecord | undefined>(BOOK_CHAPTERS_STORE, 'readonly', (store) =>
      store.get(chapterKey(bookId, chapterId)),
    )
  } catch {
    return undefined
  }
}

export async function putBookChapter(input: {
  bookId: string
  chapterId: string
  index: number
  title: string
  body: string
}): Promise<boolean> {
  const byteSize = estimateRecordBytes(input)
  const key = chapterKey(input.bookId, input.chapterId)
  const existing = await getBookChapter(input.bookId, input.chapterId)
  const currentTotal = await readByteTotal()
  const projectedTotal = currentTotal - (existing?.byteSize ?? 0) + byteSize

  if (await wouldExceedDataCapacity(projectedTotal)) {
    return false
  }

  const record: BookChapterRecord = {
    key,
    bookId: input.bookId,
    chapterId: input.chapterId,
    index: input.index,
    title: input.title,
    body: input.body,
    byteSize,
  }

  await runDataStoreTransaction(BOOK_CHAPTERS_STORE, 'readwrite', (store) => store.put(record))
  await writeByteTotal(projectedTotal)
  emitDataStorageChanged()
  return true
}

export async function assertBookChapterCapacity(input: {
  bookId: string
  chapterId: string
  index: number
  title: string
  body: string
}): Promise<void> {
  const ok = await putBookChapter(input)
  if (!ok) {
    throw new DeviceDataStorageFullError()
  }
}

export async function deleteBookChapterRecords(
  bookId: string,
  chapterIds: string[],
): Promise<void> {
  if (chapterIds.length === 0) {
    return
  }

  try {
    const records = await Promise.all(
      chapterIds.map((chapterId) => getBookChapter(bookId, chapterId)),
    )
    const existing = records.filter(
      (record): record is BookChapterRecord => record !== undefined,
    )
    if (existing.length === 0) {
      return
    }

    const freedBytes = existing.reduce((total, record) => total + (record.byteSize ?? 0), 0)
    await runDataStoreTransaction(BOOK_CHAPTERS_STORE, 'readwrite', (store) => {
      for (const record of existing) {
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

export async function deleteBookChapters(bookId: string): Promise<void> {
  try {
    const records = await runDataStoreTransaction<BookChapterRecord[]>(
      BOOK_CHAPTERS_STORE,
      'readonly',
      (store) => store.index('bookId').getAll(bookId),
    )
    if (records.length === 0) {
      return
    }

    const freedBytes = records.reduce((total, record) => total + (record.byteSize ?? 0), 0)
    await runDataStoreTransaction(BOOK_CHAPTERS_STORE, 'readwrite', (store) => {
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

export async function getFolderIconSnapshotsBytes(): Promise<number> {
  try {
    return sumStoreBytes(FOLDER_ICON_SNAPSHOTS_STORE)
  } catch {
    return 0
  }
}

export async function getModelVisionResultsBytes(): Promise<number> {
  try {
    const [resultsBytes, mediaBytes] = await Promise.all([
      sumStoreBytes(MODEL_VISION_RESULTS_STORE),
      sumStoreBytes(MODEL_VISION_MEDIA_STORE),
    ])
    return resultsBytes + mediaBytes
  } catch {
    return 0
  }
}

export async function rebuildDataByteTotal(): Promise<number> {
  try {
    const [
      bookChapterBytes,
      bookDetailBytes,
      cacheBytes,
      aiUsageBytes,
      aiEventLogBytes,
      folderIconSnapshotBytes,
      modelVisionBytes,
    ] = await Promise.all([
      sumStoreBytes(BOOK_CHAPTERS_STORE),
      sumStoreBytes(BOOK_DETAILS_STORE),
      sumStoreBytes(SAFARI_PAGE_CACHE_STORE),
      sumStoreBytes(AI_TOKEN_USAGE_STORE),
      sumStoreBytes(AI_EVENT_LOG_STORE),
      sumStoreBytes(FOLDER_ICON_SNAPSHOTS_STORE),
      sumStoreBytes(MODEL_VISION_RESULTS_STORE).then(async (resultsBytes) => {
        const mediaBytes = await sumStoreBytes(MODEL_VISION_MEDIA_STORE)
        return resultsBytes + mediaBytes
      }),
    ])
    const total =
      bookChapterBytes +
      bookDetailBytes +
      cacheBytes +
      aiUsageBytes +
      aiEventLogBytes +
      folderIconSnapshotBytes +
      modelVisionBytes
    await writeByteTotal(total)
    emitDataStorageChanged()
    return total
  } catch {
    return 0
  }
}

const DEV_DATA_FILL_HOSTNAME = 'dev-data-fill'
const DEV_DATA_FILL_URL_PREFIX = 'instant-os://dev-data-fill/'
const DEV_DATA_FILL_CHUNK_HTML_CHARS = 2 * 1024 * 1024

/** 开发者调试：将数据空间写入至硬上限（以网页缓存条目形式落盘）。 */
export async function fillDataStorageToCapacityForDev(): Promise<{
  addedBytes: number
  totalBytes: number
}> {
  const filesBytes = await getFilesBytesForQuota()
  const startTotal = await readByteTotal()
  let currentTotal = startTotal
  let chunkIndex = 0

  while (true) {
    const remaining = DATA_CAPACITY_BYTES - (currentTotal + filesBytes)
    if (remaining <= 0) {
      break
    }

    const baseFields = {
      url: `${DEV_DATA_FILL_URL_PREFIX}${chunkIndex}`,
      hostname: DEV_DATA_FILL_HOSTNAME,
      title: '开发者数据空间填充',
      pageTokens: undefined as number | undefined,
      cachedAt: Date.now(),
    }

    const emptyBytes = estimateSafariPageCacheBytes({ ...baseFields, html: '' })
    if (emptyBytes > remaining) {
      break
    }

    let low = 0
    let high = Math.min(DEV_DATA_FILL_CHUNK_HTML_CHARS, remaining)
    let bestHtml = ''
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const html = 'x'.repeat(mid)
      const size = estimateSafariPageCacheBytes({ ...baseFields, html })
      if (size <= remaining) {
        bestHtml = html
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    const input = { ...baseFields, html: bestHtml }
    const byteSize = estimateSafariPageCacheBytes(input)
    const existing = await getSafariPageCacheRecord(input.url)
    const projectedTotal = currentTotal - (existing?.byteSize ?? 0) + byteSize
    if (await wouldExceedDataCapacity(projectedTotal)) {
      break
    }

    const record: SafariPageCacheRecord = { ...input, byteSize }
    await runDataStoreTransaction(SAFARI_PAGE_CACHE_STORE, 'readwrite', (store) => store.put(record))
    currentTotal = projectedTotal
    await writeByteTotal(currentTotal)
    chunkIndex += 1

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0)
    })
  }

  if (currentTotal !== startTotal) {
    emitDataStorageChanged()
  }

  return {
    addedBytes: currentTotal - startTotal,
    totalBytes: currentTotal + filesBytes,
  }
}

/** 开发者调试：清除「写满数据空间」产生的填充数据。 */
export async function clearDevDataStorageFill(): Promise<void> {
  await clearSafariPageCacheByHostname(DEV_DATA_FILL_HOSTNAME)
}

/** 开发者调试填充占用的字节数（计入数据空间「其他」）。 */
export async function getDevDataStorageFillBytes(): Promise<number> {
  try {
    const records = await runDataStoreTransaction<SafariPageCacheRecord[]>(
      SAFARI_PAGE_CACHE_STORE,
      'readonly',
      (store) => store.index('hostname').getAll(DEV_DATA_FILL_HOSTNAME),
    )
    return records.reduce((total, record) => total + record.byteSize, 0)
  } catch {
    return 0
  }
}
