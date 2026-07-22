import type { GithubRepoSummary } from './github-api.ts'
import { githubRepoId } from './github-repo-paths.ts'

/** 从 GitHub API 拉取并持久化的仓库快照 */
export type GithubStoredRemoteRepo = GithubRepoSummary & {
  fetchedAt: number
}

export function stampGithubStoredRemoteRepo(
  summary: GithubRepoSummary,
  fetchedAt = Date.now(),
): GithubStoredRemoteRepo {
  return { ...summary, fetchedAt }
}

export type GithubFileIndexEntry = {
  hash: string
  byteSize: number
}

export type GithubBranchSnapshot = {
  tipSha: string
  fileIndex: Record<string, GithubFileIndexEntry>
}

export type GithubLocalCommit = {
  sha: string
  message: string
  parentSha?: string
  author: string
  committedAt: number
  branch: string
}

export type GithubRepoSyncMeta = {
  version: 2
  owner: string
  repo: string
  currentBranch: string
  defaultBranch: string
  branches: Record<string, GithubBranchSnapshot>
  updatedAt: number
  /** 最近一次成功 Fetch（含拉取后附带刷新）的时间戳 */
  lastFetchedAt?: number
  /**
   * 对齐 Desktop `Repository.missing`：
   * 克隆失败占位、或本地工作树丢失时为 true，可点进后「重新克隆」。
   */
  missing?: boolean
  /** 最近一次从 GitHub API 同步的仓库元数据（克隆 / 获取时更新） */
  remote?: GithubStoredRemoteRepo
}

/** 磁盘上可能仍是 v1 */
type GithubRepoSyncMetaV1 = {
  version: 1
  owner: string
  repo: string
  currentBranch: string
  headSha: string
  defaultBranch: string
  fileIndex: Record<string, GithubFileIndexEntry>
  updatedAt: number
}

type StoredRepoMeta = GithubRepoSyncMeta | GithubRepoSyncMetaV1

const DB_NAME = 'instant-os-github-repos'
const DB_VERSION = 4
const STORE = 'repos'
const COMMITS_STORE = 'commits'
/** 已看过的远端 commit 详情（按 sha 不可变，可安全缓存） */
const COMMIT_DETAILS_STORE = 'commit-details'
/** 上次 Fetch/Pull 拿到的 commit 列表（按 tip 缓存） */
const COMMIT_LISTS_STORE = 'commit-lists'
const MAX_CACHED_COMMIT_DETAILS = 100

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
      if (!db.objectStoreNames.contains(COMMITS_STORE)) {
        db.createObjectStore(COMMITS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(COMMIT_DETAILS_STORE)) {
        db.createObjectStore(COMMIT_DETAILS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(COMMIT_LISTS_STORE)) {
        db.createObjectStore(COMMIT_LISTS_STORE, { keyPath: 'id' })
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

type RepoRecord = StoredRepoMeta & { id: string }

type CommitsRecord = {
  id: string
  commits: GithubLocalCommit[]
}

/** 与 GithubCommitDetail 同形；放在此避免 sync-meta ↔ api 循环依赖 */
export type GithubCachedCommitDetail = {
  sha: string
  message: string
  authorName: string
  authorDate: string
  files: Array<{
    filename: string
    status: string
    patch?: string
  }>
}

type CommitDetailsRecord = {
  id: string
  /** 最近访问顺序（新在前），用于淘汰 */
  recentShas: string[]
  bySha: Record<string, GithubCachedCommitDetail>
}

export type GithubCachedCommitSummary = {
  sha: string
  message: string
  authorName: string
  authorDate: string
}

type CommitListRecord = {
  id: string
  tipSha: string
  commits: GithubCachedCommitSummary[]
}

export function migrateRepoMetaToV2(raw: StoredRepoMeta): GithubRepoSyncMeta {
  if (raw.version === 2) return raw
  return {
    version: 2,
    owner: raw.owner,
    repo: raw.repo,
    currentBranch: raw.currentBranch,
    defaultBranch: raw.defaultBranch,
    branches: {
      [raw.currentBranch]: {
        tipSha: raw.headSha,
        fileIndex: raw.fileIndex,
      },
    },
    updatedAt: raw.updatedAt,
  }
}

export function currentBranchSnapshot(meta: GithubRepoSyncMeta): GithubBranchSnapshot {
  const snap = meta.branches[meta.currentBranch]
  if (snap) return snap
  return { tipSha: '', fileIndex: {} }
}

export function currentHeadSha(meta: GithubRepoSyncMeta): string {
  return currentBranchSnapshot(meta).tipSha
}

export function currentFileIndex(
  meta: GithubRepoSyncMeta,
): Record<string, GithubFileIndexEntry> {
  return currentBranchSnapshot(meta).fileIndex
}

export function withBranchSnapshot(
  meta: GithubRepoSyncMeta,
  branch: string,
  snapshot: GithubBranchSnapshot,
  options?: { currentBranch?: string },
): GithubRepoSyncMeta {
  return {
    ...meta,
    version: 2,
    currentBranch: options?.currentBranch ?? meta.currentBranch,
    branches: {
      ...meta.branches,
      [branch]: snapshot,
    },
  }
}

export async function listGithubRepoMeta(): Promise<GithubRepoSyncMeta[]> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const records = await requestToPromise(
    tx.objectStore(STORE).getAll() as IDBRequest<RepoRecord[]>,
  )
  await waitForTransaction(tx)
  return (records ?? [])
    .map(({ id: _id, ...meta }) => migrateRepoMetaToV2(meta))
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
  const migrated = migrateRepoMetaToV2(meta)
  if (meta.version !== 2) {
    await saveGithubRepoMeta(migrated)
  }
  return migrated
}

export async function saveGithubRepoMeta(meta: GithubRepoSyncMeta): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const normalized: GithubRepoSyncMeta = { ...meta, version: 2 }
  if (!normalized.missing) {
    delete normalized.missing
  }
  tx.objectStore(STORE).put({
    ...normalized,
    id: githubRepoId(meta.owner, meta.repo),
  } satisfies RepoRecord)
  await waitForTransaction(tx)
}

/** 克隆失败或工作树丢失时写入/更新占位记录，便于列表保留并可重新克隆 */
export async function saveGithubMissingRepoMeta(
  owner: string,
  repo: string,
): Promise<GithubRepoSyncMeta> {
  const existing = await getGithubRepoMeta(owner, repo)
  const meta: GithubRepoSyncMeta = existing
    ? { ...existing, missing: true, updatedAt: Date.now() }
    : {
        version: 2,
        owner,
        repo,
        currentBranch: 'main',
        defaultBranch: 'main',
        branches: {},
        updatedAt: Date.now(),
        missing: true,
      }
  await saveGithubRepoMeta(meta)
  return meta
}

export async function deleteGithubRepoMeta(owner: string, repo: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(
    [STORE, COMMITS_STORE, COMMIT_DETAILS_STORE, COMMIT_LISTS_STORE],
    'readwrite',
  )
  const id = githubRepoId(owner, repo)
  tx.objectStore(STORE).delete(id)
  tx.objectStore(COMMITS_STORE).delete(id)
  tx.objectStore(COMMIT_DETAILS_STORE).delete(id)
  tx.objectStore(COMMIT_LISTS_STORE).delete(id)
  await waitForTransaction(tx)
}

export async function listGithubLocalCommits(
  owner: string,
  repo: string,
): Promise<GithubLocalCommit[]> {
  const db = await openDb()
  const tx = db.transaction(COMMITS_STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(COMMITS_STORE).get(githubRepoId(owner, repo)) as IDBRequest<
      CommitsRecord | undefined
    >,
  )
  await waitForTransaction(tx)
  return record?.commits ?? []
}

export async function appendGithubLocalCommit(
  owner: string,
  repo: string,
  commit: GithubLocalCommit,
): Promise<void> {
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = db.transaction(COMMITS_STORE, 'readwrite')
  const store = tx.objectStore(COMMITS_STORE)
  const existing = await requestToPromise(
    store.get(id) as IDBRequest<CommitsRecord | undefined>,
  )
  const commits = existing?.commits ?? []
  const withoutDup = commits.filter((item) => item.sha !== commit.sha)
  withoutDup.unshift(commit)
  store.put({ id, commits: withoutDup.slice(0, 200) } satisfies CommitsRecord)
  await waitForTransaction(tx)
}

export async function getCachedGithubCommitDetail(
  owner: string,
  repo: string,
  sha: string,
): Promise<GithubCachedCommitDetail | undefined> {
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = db.transaction(COMMIT_DETAILS_STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(COMMIT_DETAILS_STORE).get(id) as IDBRequest<
      CommitDetailsRecord | undefined
    >,
  )
  await waitForTransaction(tx)
  return record?.bySha[sha]
}

export async function putCachedGithubCommitDetail(
  owner: string,
  repo: string,
  detail: GithubCachedCommitDetail,
): Promise<void> {
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = db.transaction(COMMIT_DETAILS_STORE, 'readwrite')
  const store = tx.objectStore(COMMIT_DETAILS_STORE)
  const existing = await requestToPromise(
    store.get(id) as IDBRequest<CommitDetailsRecord | undefined>,
  )
  const bySha = { ...(existing?.bySha ?? {}) }
  const recentShas = (existing?.recentShas ?? []).filter((item) => item !== detail.sha)
  recentShas.unshift(detail.sha)
  bySha[detail.sha] = detail
  while (recentShas.length > MAX_CACHED_COMMIT_DETAILS) {
    const evicted = recentShas.pop()
    if (evicted) delete bySha[evicted]
  }
  store.put({ id, recentShas, bySha } satisfies CommitDetailsRecord)
  await waitForTransaction(tx)
}

export async function getCachedGithubCommitList(
  owner: string,
  repo: string,
): Promise<CommitListRecord | undefined> {
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = db.transaction(COMMIT_LISTS_STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(COMMIT_LISTS_STORE).get(id) as IDBRequest<CommitListRecord | undefined>,
  )
  await waitForTransaction(tx)
  return record
}

export async function putCachedGithubCommitList(
  owner: string,
  repo: string,
  tipSha: string,
  commits: GithubCachedCommitSummary[],
): Promise<void> {
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = db.transaction(COMMIT_LISTS_STORE, 'readwrite')
  tx.objectStore(COMMIT_LISTS_STORE).put({
    id,
    tipSha,
    commits,
  } satisfies CommitListRecord)
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
