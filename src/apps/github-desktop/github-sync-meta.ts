import type { GithubRepoSummary } from './github-api.ts'
import { githubRepoId } from './github-repo-paths.ts'
import { beginIdbTransaction } from '../../os/idb-transaction.ts'

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
  /** 基线 blob 已齐全；切换分支时可跳过全量存在性扫描 */
  baselineComplete?: boolean
  /** 上次成功推送到远端后的 tip；缺省时视为与远端 tip 一致 */
  pushedTipSha?: string
}

export type GithubLocalCommitChange = {
  path: string
  kind: 'added' | 'modified' | 'deleted'
}

export type GithubLocalCommit = {
  sha: string
  message: string
  parentSha?: string
  author: string
  committedAt: number
  branch: string
  /** push 成功后写入的远端 commit sha */
  remoteSha?: string
  /** 本地 commit 的路径级变更，供 push 时重建 tree */
  changes?: GithubLocalCommitChange[]
  /** commit 完成后的 fileIndex 快照，供 push 时读取 blob */
  fileIndexAfter?: Record<string, GithubFileIndexEntry>
  /** commit 前的 fileIndex 快照，供本地历史 diff 使用 */
  fileIndexBefore?: Record<string, GithubFileIndexEntry>
}

const LOCAL_COMMIT_SHA_PREFIX = 'local-'

export function createLocalCommitSha(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${LOCAL_COMMIT_SHA_PREFIX}${hex}`
}

export function isLocalCommitSha(sha: string): boolean {
  return sha.startsWith(LOCAL_COMMIT_SHA_PREFIX)
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
const DB_VERSION = 5
const STORE = 'repos'
const COMMITS_STORE = 'commits'
/** 已看过的远端 commit 详情（按 sha 不可变，可安全缓存） */
const COMMIT_DETAILS_STORE = 'commit-details'
/** 上次 Fetch/Pull 拿到的 commit 列表（按 tip 缓存） */
const COMMIT_LISTS_STORE = 'commit-lists'
/** 本地 stash（按仓库 id 一条记录） */
const STASHES_STORE = 'stashes'
const MAX_CACHED_COMMIT_DETAILS = 100

/** 仓库 meta / 同步账本变更（供 Desktop 跨应用实时刷新） */
export type GithubRepoMetaChange = {
  owner: string
  repo: string
  kind: 'updated' | 'deleted'
}

type GithubRepoMetaListener = (change: GithubRepoMetaChange) => void

const githubRepoMetaListeners = new Set<GithubRepoMetaListener>()

/** 订阅本地仓库 meta 写入；终端 instant.git 与 Desktop 共用同一账本 */
export function subscribeGithubRepoMeta(listener: GithubRepoMetaListener): () => void {
  githubRepoMetaListeners.add(listener)
  return () => {
    githubRepoMetaListeners.delete(listener)
  }
}

/** 由 save / 账本写入成功后调用；也可供测试手动触发 */
export function notifyGithubRepoMetaChanged(change: GithubRepoMetaChange): void {
  if (githubRepoMetaListeners.size === 0) return
  for (const listener of [...githubRepoMetaListeners]) {
    try {
      listener(change)
    } catch (err) {
      console.error('[github-sync-meta] listener error', err)
    }
  }
}

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
      if (!db.objectStoreNames.contains(STASHES_STORE)) {
        db.createObjectStore(STASHES_STORE, { keyPath: 'id' })
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

export type GithubStashChange = {
  path: string
  kind: 'added' | 'modified' | 'deleted'
}

export type GithubStashEntry = {
  id: string
  branch: string
  createdAt: number
  message?: string
  changes: GithubStashChange[]
  /** added/modified 路径的基线 blob；deleted 无条目 */
  blobs: Record<string, GithubFileIndexEntry>
}

type StashesRecord = {
  id: string
  entries: GithubStashEntry[]
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

/** 当前分支上次推送到远端后的 tip；旧数据缺省时回退到远端 tip 或本地 tip */
export function currentBranchPushedSha(meta: GithubRepoSyncMeta): string {
  const snap = currentBranchSnapshot(meta)
  if (snap.pushedTipSha) return snap.pushedTipSha
  return currentBranchRemoteSha(meta) ?? snap.tipSha
}

/** 本地是否有尚未推送到远端的提交 */
export function branchHasUnpushedCommits(meta: GithubRepoSyncMeta): boolean {
  const tipSha = currentHeadSha(meta)
  if (!tipSha) return false
  return tipSha !== currentBranchPushedSha(meta)
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

/** 本地快照是否可信任其基线 blob 齐全（避免切换时全量 stat 扫描） */
export function branchBaselineTrusted(snapshot: GithubBranchSnapshot | undefined): boolean {
  if (!snapshot) return false
  if (snapshot.baselineComplete) return true
  return Object.keys(snapshot.fileIndex).length > 0 && Boolean(snapshot.tipSha)
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
  const tx = beginIdbTransaction(db, STORE, 'readonly')
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
  const tx = beginIdbTransaction(db, STORE, 'readonly')
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
  const tx = beginIdbTransaction(db, STORE, 'readwrite')
  const normalized: GithubRepoSyncMeta = { ...meta, version: 2 }
  if (!normalized.missing) {
    delete normalized.missing
  }
  tx.objectStore(STORE).put({
    ...normalized,
    id: githubRepoId(meta.owner, meta.repo),
  } satisfies RepoRecord)
  await waitForTransaction(tx)
  notifyGithubRepoMetaChanged({
    owner: meta.owner,
    repo: meta.repo,
    kind: 'updated',
  })
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
  const tx = beginIdbTransaction(db, 
    [STORE, COMMITS_STORE, COMMIT_DETAILS_STORE, COMMIT_LISTS_STORE, STASHES_STORE],
    'readwrite',
  )
  const id = githubRepoId(owner, repo)
  tx.objectStore(STORE).delete(id)
  tx.objectStore(COMMITS_STORE).delete(id)
  tx.objectStore(COMMIT_DETAILS_STORE).delete(id)
  tx.objectStore(COMMIT_LISTS_STORE).delete(id)
  tx.objectStore(STASHES_STORE).delete(id)
  await waitForTransaction(tx)
  notifyGithubRepoMetaChanged({ owner, repo, kind: 'deleted' })
}

export async function listGithubLocalCommits(
  owner: string,
  repo: string,
): Promise<GithubLocalCommit[]> {
  const db = await openDb()
  const tx = beginIdbTransaction(db, COMMITS_STORE, 'readonly')
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
  const tx = beginIdbTransaction(db, COMMITS_STORE, 'readwrite')
  const store = tx.objectStore(COMMITS_STORE)
  const existing = await requestToPromise(
    store.get(id) as IDBRequest<CommitsRecord | undefined>,
  )
  const commits = existing?.commits ?? []
  const withoutDup = commits.filter((item) => item.sha !== commit.sha)
  withoutDup.unshift(commit)
  store.put({ id, commits: withoutDup.slice(0, 200) } satisfies CommitsRecord)
  await waitForTransaction(tx)
  notifyGithubRepoMetaChanged({ owner, repo, kind: 'updated' })
}

export async function listUnpushedLocalCommits(
  owner: string,
  repo: string,
  branch: string,
): Promise<GithubLocalCommit[]> {
  const commits = await listGithubLocalCommits(owner, repo)
  return commits
    .filter(
      (item) =>
        item.branch === branch && isLocalCommitSha(item.sha) && item.remoteSha === undefined,
    )
    .sort((a, b) => a.committedAt - b.committedAt)
}

export async function finalizePushedLocalCommits(
  owner: string,
  repo: string,
  mappings: ReadonlyArray<{ localSha: string; remoteSha: string }>,
): Promise<void> {
  if (mappings.length === 0) return
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = beginIdbTransaction(db, COMMITS_STORE, 'readwrite')
  const store = tx.objectStore(COMMITS_STORE)
  const existing = await requestToPromise(
    store.get(id) as IDBRequest<CommitsRecord | undefined>,
  )
  const byLocalSha = new Map(mappings.map((item) => [item.localSha, item.remoteSha]))
  const commits = (existing?.commits ?? []).map((item) => {
    const remoteSha = byLocalSha.get(item.sha)
    if (!remoteSha) return item
    return { ...item, sha: remoteSha, remoteSha }
  })
  store.put({ id, commits } satisfies CommitsRecord)
  await waitForTransaction(tx)
  notifyGithubRepoMetaChanged({ owner, repo, kind: 'updated' })
}

/** 变基后按 sha 写回未推送本地 commit（保留其它历史） */
export async function replaceUnpushedLocalCommits(
  owner: string,
  repo: string,
  rewritten: ReadonlyArray<GithubLocalCommit>,
): Promise<void> {
  if (rewritten.length === 0) return
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = beginIdbTransaction(db, COMMITS_STORE, 'readwrite')
  const store = tx.objectStore(COMMITS_STORE)
  const existing = await requestToPromise(
    store.get(id) as IDBRequest<CommitsRecord | undefined>,
  )
  const bySha = new Map(rewritten.map((item) => [item.sha, item]))
  const commits = (existing?.commits ?? []).map((item) => bySha.get(item.sha) ?? item)
  store.put({ id, commits } satisfies CommitsRecord)
  await waitForTransaction(tx)
  notifyGithubRepoMetaChanged({ owner, repo, kind: 'updated' })
}

export async function removeGithubLocalCommit(
  owner: string,
  repo: string,
  sha: string,
): Promise<void> {
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = beginIdbTransaction(db, COMMITS_STORE, 'readwrite')
  const store = tx.objectStore(COMMITS_STORE)
  const existing = await requestToPromise(
    store.get(id) as IDBRequest<CommitsRecord | undefined>,
  )
  const commits = (existing?.commits ?? []).filter((item) => item.sha !== sha)
  store.put({ id, commits } satisfies CommitsRecord)
  await waitForTransaction(tx)
  notifyGithubRepoMetaChanged({ owner, repo, kind: 'updated' })
}

/** 将某分支上的未推送本地 commit 改挂到新分支名 */
export async function reassignUnpushedLocalCommitsBranch(
  owner: string,
  repo: string,
  fromBranch: string,
  toBranch: string,
): Promise<void> {
  if (fromBranch === toBranch) return
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = beginIdbTransaction(db, COMMITS_STORE, 'readwrite')
  const store = tx.objectStore(COMMITS_STORE)
  const existing = await requestToPromise(
    store.get(id) as IDBRequest<CommitsRecord | undefined>,
  )
  const commits = (existing?.commits ?? []).map((item) => {
    if (
      item.branch === fromBranch &&
      isLocalCommitSha(item.sha) &&
      item.remoteSha === undefined
    ) {
      return { ...item, branch: toBranch }
    }
    return item
  })
  store.put({ id, commits } satisfies CommitsRecord)
  await waitForTransaction(tx)
  notifyGithubRepoMetaChanged({ owner, repo, kind: 'updated' })
}

export async function listGithubStashes(
  owner: string,
  repo: string,
): Promise<GithubStashEntry[]> {
  const db = await openDb()
  const tx = beginIdbTransaction(db, STASHES_STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(STASHES_STORE).get(githubRepoId(owner, repo)) as IDBRequest<
      StashesRecord | undefined
    >,
  )
  await waitForTransaction(tx)
  return record?.entries ?? []
}

export async function pushGithubStashEntry(
  owner: string,
  repo: string,
  entry: GithubStashEntry,
): Promise<void> {
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = beginIdbTransaction(db, STASHES_STORE, 'readwrite')
  const store = tx.objectStore(STASHES_STORE)
  const existing = await requestToPromise(
    store.get(id) as IDBRequest<StashesRecord | undefined>,
  )
  const entries = [entry, ...(existing?.entries ?? [])].slice(0, 50)
  store.put({ id, entries } satisfies StashesRecord)
  await waitForTransaction(tx)
  notifyGithubRepoMetaChanged({ owner, repo, kind: 'updated' })
}

export async function removeGithubStashEntry(
  owner: string,
  repo: string,
  stashId: string,
): Promise<GithubStashEntry | undefined> {
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = beginIdbTransaction(db, STASHES_STORE, 'readwrite')
  const store = tx.objectStore(STASHES_STORE)
  const existing = await requestToPromise(
    store.get(id) as IDBRequest<StashesRecord | undefined>,
  )
  const entries = existing?.entries ?? []
  const hit = entries.find((item) => item.id === stashId)
  if (!hit) {
    await waitForTransaction(tx)
    return undefined
  }
  store.put({
    id,
    entries: entries.filter((item) => item.id !== stashId),
  } satisfies StashesRecord)
  await waitForTransaction(tx)
  notifyGithubRepoMetaChanged({ owner, repo, kind: 'updated' })
  return hit
}

export async function getCachedGithubCommitDetail(
  owner: string,
  repo: string,
  sha: string,
): Promise<GithubCachedCommitDetail | undefined> {
  const db = await openDb()
  const id = githubRepoId(owner, repo)
  const tx = beginIdbTransaction(db, COMMIT_DETAILS_STORE, 'readonly')
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
  const tx = beginIdbTransaction(db, COMMIT_DETAILS_STORE, 'readwrite')
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
  const tx = beginIdbTransaction(db, COMMIT_LISTS_STORE, 'readonly')
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
  const tx = beginIdbTransaction(db, COMMIT_LISTS_STORE, 'readwrite')
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
