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
  /** 对齐 tip 时的 contentRevisionId；旧数据可能缺省 */
  revisionId?: string
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

/** 最近一次 Fetch 缓存的远端分支（持久化，刷新后仍显示） */
export type GithubStoredRemoteBranch = {
  name: string
  commitSha: string
  protected: boolean
}

/** 分支下拉列表条目（远端列表 + 本地快照标记） */
export type GithubDesktopBranchListItem = GithubStoredRemoteBranch & {
  hasLocalSnapshot: boolean
  localTipSha: string | undefined
}

/** 分支下拉分组：主分支 / 最近 / 其余 */
export type GithubDesktopBranchListSections = {
  defaultBranch: GithubDesktopBranchListItem | undefined
  recent: GithubDesktopBranchListItem[]
  other: GithubDesktopBranchListItem[]
}

const MAX_RECENT_BRANCHES = 8

export type GithubRepoSyncMeta = {
  version: 2
  owner: string
  repo: string
  currentBranch: string
  defaultBranch: string
  branches: Record<string, GithubBranchSnapshot>
  /** 最近一次 Fetch 拿到的远端分支列表 */
  remoteBranches?: GithubStoredRemoteBranch[]
  /** 最近切换过的分支名（新在前），供分支下拉「最近分支」分组 */
  recentBranches?: string[]
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

/** 最近一次 Fetch 缓存的、当前分支远端 tip（未 Fetch 过则为 undefined） */
export function currentBranchRemoteSha(meta: GithubRepoSyncMeta): string | undefined {
  for (const remote of meta.remoteBranches ?? []) {
    if (remote.name === meta.currentBranch) return remote.commitSha
  }
  return undefined
}

/** 切换分支或单独查询 tip 后，对齐远端分支列表里该分支的 commitSha */
export function withRemoteBranchTip(
  meta: GithubRepoSyncMeta,
  branch: string,
  commitSha: string,
): GithubRepoSyncMeta {
  const existing = meta.remoteBranches ?? []
  const hit = existing.find((item) => item.name === branch)
  if (hit?.commitSha === commitSha) return meta
  const remoteBranches = hit
    ? existing.map((item) => (item.name === branch ? { ...item, commitSha } : item))
    : [...existing, { name: branch, commitSha, protected: false }]
  return { ...meta, remoteBranches }
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

function branchHasLocalSnapshot(snapshot: GithubBranchSnapshot | undefined): boolean {
  if (!snapshot) return false
  return Object.keys(snapshot.fileIndex).length > 0 || Boolean(snapshot.tipSha)
}

/** 合并持久化的远端分支列表与本地快照，供分支下拉使用 */
export function buildRepoBranchList(meta: GithubRepoSyncMeta): GithubDesktopBranchListItem[] {
  const byName = new Map<string, GithubDesktopBranchListItem>()

  for (const remote of meta.remoteBranches ?? []) {
    const local = meta.branches[remote.name]
    byName.set(remote.name, {
      name: remote.name,
      commitSha: remote.commitSha,
      protected: remote.protected,
      hasLocalSnapshot: branchHasLocalSnapshot(local),
      localTipSha: local?.tipSha || undefined,
    })
  }

  for (const [name, local] of Object.entries(meta.branches)) {
    if (byName.has(name)) continue
    byName.set(name, {
      name,
      commitSha: local.tipSha,
      protected: false,
      hasLocalSnapshot: branchHasLocalSnapshot(local),
      localTipSha: local.tipSha || undefined,
    })
  }

  if (byName.size === 0) {
    const local = meta.branches[meta.currentBranch]
    return [
      {
        name: meta.currentBranch,
        commitSha: currentHeadSha(meta),
        protected: false,
        hasLocalSnapshot: branchHasLocalSnapshot(local),
        localTipSha: currentHeadSha(meta) || undefined,
      },
    ]
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 记录分支切换，更新最近分支列表 */
export function touchRecentBranch(
  meta: GithubRepoSyncMeta,
  branch: string,
): GithubRepoSyncMeta {
  const name = branch.trim()
  if (!name) return meta
  const prev = meta.recentBranches ?? []
  const next = [name, ...prev.filter((item) => item !== name)].slice(0, MAX_RECENT_BRANCHES)
  if (next.length === prev.length && next.every((item, index) => item === prev[index])) {
    return meta
  }
  return { ...meta, recentBranches: next }
}

/** 将分支列表拆成主分支 / 最近 / 其余三组 */
export function groupRepoBranchList(
  meta: GithubRepoSyncMeta,
  branches: GithubDesktopBranchListItem[],
): GithubDesktopBranchListSections {
  const byName = new Map(branches.map((branch) => [branch.name, branch]))
  const defaultBranch = byName.get(meta.defaultBranch)
  let recent = (meta.recentBranches ?? [])
    .filter((name) => name !== meta.defaultBranch && byName.has(name))
    .map((name) => byName.get(name)!)
  if (recent.length === 0) {
    const current = byName.get(meta.currentBranch)
    if (current && current.name !== meta.defaultBranch) {
      recent = [current]
    }
  }
  const recentNames = new Set(recent.map((branch) => branch.name))
  const other = branches
    .filter((branch) => branch.name !== meta.defaultBranch && !recentNames.has(branch.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { defaultBranch, recent, other }
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
  revisionIds?: ReadonlyMap<string, string | undefined>,
): Promise<Record<string, GithubFileIndexEntry>> {
  const index: Record<string, GithubFileIndexEntry> = {}
  for (const [path, bytes] of files) {
    const entry: GithubFileIndexEntry = {
      hash: await hashBytes(bytes),
      byteSize: bytes.byteLength,
    }
    const revisionId = revisionIds?.get(path)
    if (revisionId !== undefined) {
      entry.revisionId = revisionId
    }
    index[path] = entry
  }
  return index
}

/** 工作区文件元数据快照（不含正文） */
export type GithubRevisionSnapshotEntry = {
  path: string
  absolutePath: string
  byteSize: number
  contentRevisionId: string | undefined
}

/**
 * 从 revision 快照构建 fileIndex。
 * hash 优先复用 previousIndex 中 revisionId 未变的路径；仅对新增 / revision 变化的路径调用 hashPath。
 */
export async function buildFileIndexFromRevisionSnapshot(
  snapshot: readonly GithubRevisionSnapshotEntry[],
  options?: {
    previousIndex?: Record<string, GithubFileIndexEntry>
    hashPath: (absolutePath: string) => Promise<{ hash: string; byteSize: number }>
  },
): Promise<Record<string, GithubFileIndexEntry>> {
  const previous = options?.previousIndex ?? {}
  const hashPath = options?.hashPath
  if (!hashPath) {
    throw new Error('buildFileIndexFromRevisionSnapshot 需要 hashPath')
  }

  const index: Record<string, GithubFileIndexEntry> = {}
  for (const entry of snapshot) {
    const prev = previous[entry.path]
    const revisionId = entry.contentRevisionId
    if (
      prev &&
      revisionId !== undefined &&
      prev.revisionId !== undefined &&
      prev.revisionId === revisionId
    ) {
      index[entry.path] = {
        hash: prev.hash,
        byteSize: entry.byteSize,
        revisionId,
      }
      continue
    }
    const hashed = await hashPath(entry.absolutePath)
    const next: GithubFileIndexEntry = {
      hash: hashed.hash,
      byteSize: hashed.byteSize,
    }
    if (revisionId !== undefined) {
      next.revisionId = revisionId
    }
    index[entry.path] = next
  }
  return index
}

/**
 * 将 fileIndex 中指定路径（或全部）的 revisionId 同步为快照中的当前值。
 * discard 后必须调用，避免误报 modified。
 */
export function reconcileFileIndexRevisionIds(
  fileIndex: Record<string, GithubFileIndexEntry>,
  snapshot: readonly GithubRevisionSnapshotEntry[],
  paths?: ReadonlySet<string>,
): Record<string, GithubFileIndexEntry> {
  const byPath = new Map(snapshot.map((item) => [item.path, item]))
  const next: Record<string, GithubFileIndexEntry> = { ...fileIndex }
  const targets = paths ?? new Set(Object.keys(fileIndex))
  for (const path of targets) {
    const entry = next[path]
    if (!entry) continue
    const live = byPath.get(path)
    if (!live || live.contentRevisionId === undefined) continue
    next[path] = { ...entry, revisionId: live.contentRevisionId, byteSize: live.byteSize }
  }
  return next
}
