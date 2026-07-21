import {
  isProxyServerConnected,
  proxiedFetch,
} from '../../os/proxy-server-api.ts'
import { loadGithubCredentials } from '../../os/github-credentials-storage.ts'
import { githubTokenFingerprint } from './github-account-cache.ts'

const DB_NAME = 'instant-os-github-avatar'
const DB_VERSION = 1
const STORE = 'avatar'

type StoredAvatar = {
  id: 'current'
  tokenFingerprint: string
  sourceUrl: string
  mimeType: string
  bytes: ArrayBuffer
  fetchedAt: number
}

const MAX_AVATAR_BYTES = 512 * 1024

let dbPromise: Promise<IDBDatabase> | undefined
let liveObjectUrl: string | undefined

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = undefined
      reject(request.error ?? new Error('无法打开头像缓存'))
    }
  })
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function revokeLiveObjectUrl(): void {
  if (!liveObjectUrl) return
  URL.revokeObjectURL(liveObjectUrl)
  liveObjectUrl = undefined
}

function objectUrlFromRecord(record: StoredAvatar): string {
  revokeLiveObjectUrl()
  const blob = new Blob([record.bytes], {
    type: record.mimeType || 'image/png',
  })
  liveObjectUrl = URL.createObjectURL(blob)
  return liveObjectUrl
}

async function readStoredAvatar(): Promise<StoredAvatar | undefined> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const raw = await requestToPromise(tx.objectStore(STORE).get('current'))
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as StoredAvatar
  if (
    record.id !== 'current' ||
    typeof record.tokenFingerprint !== 'string' ||
    typeof record.sourceUrl !== 'string' ||
    !(record.bytes instanceof ArrayBuffer)
  ) {
    return undefined
  }
  return record
}

async function writeStoredAvatar(record: StoredAvatar): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(record)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('写入头像缓存失败'))
    tx.onabort = () => reject(tx.error ?? new Error('写入头像缓存已中止'))
  })
}

function currentFingerprint(): string {
  return githubTokenFingerprint(loadGithubCredentials().token)
}

/** 读取本地头像并生成可用于 <img> 的 blob URL；无缓存或 token 不匹配则 undefined */
export async function loadGithubAvatarObjectUrl(): Promise<string | undefined> {
  const fingerprint = currentFingerprint()
  if (!fingerprint) {
    revokeLiveObjectUrl()
    return undefined
  }
  try {
    const stored = await readStoredAvatar()
    if (!stored || stored.tokenFingerprint !== fingerprint) {
      revokeLiveObjectUrl()
      return undefined
    }
    return objectUrlFromRecord(stored)
  } catch {
    revokeLiveObjectUrl()
    return undefined
  }
}

/**
 * 经代理拉取第三方头像并写入 IndexedDB。
 * 代理未连接、URL 无效、或已是最新缓存时跳过（已缓存则仍返回 object URL）。
 */
export async function ensureGithubAvatarCached(
  sourceUrl: string | undefined,
): Promise<string | undefined> {
  const fingerprint = currentFingerprint()
  const url = sourceUrl?.trim()
  if (!fingerprint || !url) {
    revokeLiveObjectUrl()
    return undefined
  }

  try {
    const existing = await readStoredAvatar()
    if (
      existing &&
      existing.tokenFingerprint === fingerprint &&
      existing.sourceUrl === url
    ) {
      return objectUrlFromRecord(existing)
    }
  } catch {
    // 继续尝试下载
  }

  if (!isProxyServerConnected()) {
    // 无代理无法安全拉第三方字节；展示层可回退远程 URL
    return undefined
  }

  try {
    const response = await proxiedFetch(url)
    if (!response.ok) {
      return undefined
    }
    const mimeType = (response.headers.get('content-type') || 'image/png').split(';')[0]!.trim()
    if (!mimeType.startsWith('image/')) {
      return undefined
    }
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_AVATAR_BYTES) {
      return undefined
    }
    const record: StoredAvatar = {
      id: 'current',
      tokenFingerprint: fingerprint,
      sourceUrl: url,
      mimeType,
      bytes: buffer,
      fetchedAt: Date.now(),
    }
    await writeStoredAvatar(record)
    return objectUrlFromRecord(record)
  } catch {
    return undefined
  }
}

export async function clearGithubAvatarCache(): Promise<void> {
  revokeLiveObjectUrl()
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete('current')
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('清除头像缓存失败'))
      tx.onabort = () => reject(tx.error ?? new Error('清除头像缓存已中止'))
    })
  } catch {
    // ignore
  }
}
