import { githubRepoId } from './github-repo-paths.ts'

export type GithubFileIndexEntry = {
  hash: string
  byteSize: number
}

export type GithubRepoSyncMeta = {
  version: 1
  owner: string
  repo: string
  currentBranch: string
  headSha: string
  defaultBranch: string
  fileIndex: Record<string, GithubFileIndexEntry>
  updatedAt: number
}

const DB_NAME = 'instant-os-github-repos'
const DB_VERSION = 1
const STORE = 'repos'

let dbPromise: Promise<IDBDatabase> | undefined

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
      reject(request.error ?? new Error('无法打开 GitHub 仓库元数据'))
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

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已中止'))
  })
}

type RepoRecord = GithubRepoSyncMeta & { id: string }

export async function listGithubRepoMeta(): Promise<GithubRepoSyncMeta[]> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const records = await requestToPromise(
    tx.objectStore(STORE).getAll() as IDBRequest<RepoRecord[]>,
  )
  await waitForTransaction(tx)
  return (records ?? [])
    .map(({ id: _id, ...meta }) => meta)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getGithubRepoMeta(
  owner: string,
  repo: string,
): Promise<GithubRepoSyncMeta | undefined> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(STORE).get(githubRepoId(owner, repo)) as IDBRequest<RepoRecord | undefined>,
  )
  await waitForTransaction(tx)
  if (!record) return undefined
  const { id: _id, ...meta } = record
  return meta
}

export async function saveGithubRepoMeta(meta: GithubRepoSyncMeta): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put({
    ...meta,
    id: githubRepoId(meta.owner, meta.repo),
  } satisfies RepoRecord)
  await waitForTransaction(tx)
}

export async function deleteGithubRepoMeta(owner: string, repo: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(githubRepoId(owner, repo))
  await waitForTransaction(tx)
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function buildFileIndex(
  files: Map<string, Uint8Array>,
): Promise<Record<string, GithubFileIndexEntry>> {
  const index: Record<string, GithubFileIndexEntry> = {}
  for (const [path, bytes] of files) {
    index[path] = {
      hash: await hashBytes(bytes),
      byteSize: bytes.byteLength,
    }
  }
  return index
}
