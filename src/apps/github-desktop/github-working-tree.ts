import { unzipSync } from 'fflate'
import { osNowMs } from '../../os/os-clock.ts'
import { assertAdditionalBytesAvailable, listChildNodes } from '../files/files-storage.ts'
import {
  filesCreateBinary,
  filesList,
  filesMkdir,
  filesReadBlob,
  filesReadText,
  filesRemove,
  filesStat,
  filesUpsertBatch,
  filesWriteBinary,
  type FilesApiEntry,
  type FilesUpsertBatchItem,
} from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { resolveNodeByAbsolutePath } from '../files/files-vfs.ts'
import {
  githubDownloadZipball,
  githubGetBranchTip,
  githubGetRepo,
} from './github-api.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import { deleteGithubNodeSubtree, ensureGithubRepoRootFolder } from './github-objects-vfs.ts'
import { shouldReportGithubProgress, type GithubProgress } from './github-progress.ts'
import { persistBaselineFromFiles, readBaselineBytes } from './github-baseline.ts'
import {
  diffFileIndexes,
  type GithubFileIndexOp,
} from './github-file-index-diff.ts'
import {
  getGithubRepoMeta,
  saveGithubRepoMeta,
  stampGithubStoredRemoteRepo,
  type GithubFileIndexEntry,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'

/** 基线 blob 预取并发 */
const BASELINE_PREFETCH_CONCURRENCY = 12

function normalizeZipPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\\/g, '/')
}

function stripZipRoot(files: Record<string, Uint8Array>): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>()
  const keys = Object.keys(files).filter((key) => !key.endsWith('/'))
  if (keys.length === 0) return map

  let commonRoot: string | undefined
  for (const key of keys) {
    const normalized = normalizeZipPath(key)
    const slash = normalized.indexOf('/')
    if (slash <= 0) {
      commonRoot = undefined
      break
    }
    const root = normalized.slice(0, slash)
    if (commonRoot === undefined) commonRoot = root
    else if (commonRoot !== root) {
      commonRoot = undefined
      break
    }
  }

  for (const key of keys) {
    const normalized = normalizeZipPath(key)
    const relative =
      commonRoot && normalized.startsWith(`${commonRoot}/`)
        ? normalized.slice(commonRoot.length + 1)
        : normalized
    if (!relative || relative.endsWith('/')) continue
    const bytes = files[key]
    if (!bytes) continue
    map.set(relative, bytes)
  }
  return map
}

export function isProbablyTextBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return true
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8192))
  let suspicious = 0
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample[i]!
    if (code === 0) return false
    if (code < 7 || (code > 14 && code < 32 && code !== 27)) {
      suspicious += 1
    }
  }
  return suspicious / sample.length < 0.05
}

async function ensureParentDirs(absoluteFilePath: string): Promise<void> {
  const parts = absoluteFilePath.split('/').filter(Boolean)
  if (parts.length <= 1) return
  let current = ''
  for (let i = 0; i < parts.length - 1; i += 1) {
    current += `/${parts[i]}`
    const existing = await filesStat(current)
    if (existing) {
      if (existing.kind !== 'folder') {
        throw new Error(`路径冲突：${current} 不是文件夹`)
      }
      continue
    }
    await filesMkdir(current)
  }
}

export async function writeWorkingTreeFile(
  absolutePath: string,
  bytes: Uint8Array,
): Promise<void> {
  // 始终按原始字节落盘，保证与 fileIndex/基线 hash 一致；文本编辑靠读路径从 bytes 解码
  await ensureParentDirs(absolutePath)
  const existing = await filesStat(absolutePath)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const buffer = copy.buffer
  if (existing) {
    if (existing.kind !== 'file') throw new Error(`路径冲突：${absolutePath}`)
    await filesWriteBinary(absolutePath, buffer)
  } else {
    await filesCreateBinary(absolutePath, buffer)
  }
}

function toUpsertBatchItem(absolutePath: string, bytes: Uint8Array): FilesUpsertBatchItem {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return { path: absolutePath, bytes: copy.buffer }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return
        results[index] = await worker(items[index]!, index)
      }
    },
  )
  await Promise.all(runners)
  return results
}

export async function removeWorkingTreePath(absolutePath: string): Promise<void> {
  const existing = await filesStat(absolutePath)
  if (!existing) return
  try {
    await filesRemove(absolutePath)
  } catch (error) {
    // 并发删除或路径已消失时忽略
    if (error instanceof Error && error.message === '项目不存在') return
    throw error
  }
}

export async function clearDirectoryContents(dirPath: string): Promise<void> {
  const existing = await filesStat(dirPath)
  if (!existing) return
  if (existing.kind !== 'folder') {
    await filesRemove(dirPath)
    return
  }
  const children = await filesList(dirPath)
  for (const child of children) {
    await filesRemove(child.path)
  }
}

export async function ensureRepoRootFolder(owner: string, repo: string): Promise<string> {
  return ensureGithubRepoRootFolder(owner, repo)
}

async function listFilesRecursive(dirPath: string): Promise<FilesApiEntry[]> {
  const result: FilesApiEntry[] = []
  const stack = [dirPath]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const folder = await filesStat(current)
    if (!folder || folder.kind !== 'folder') continue
    let children: FilesApiEntry[]
    try {
      children = await filesList(current)
    } catch {
      // 工作区重写中途目录可能已被删除（如切换分支）
      continue
    }
    for (const child of children) {
      if (child.kind === 'folder') {
        stack.push(child.path)
      } else {
        result.push(child)
      }
    }
  }
  return result
}

export async function readWorkingTreeBytes(absolutePath: string): Promise<Uint8Array> {
  try {
    const blob = await filesReadBlob(absolutePath)
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    const text = await filesReadText(absolutePath)
    return new TextEncoder().encode(text)
  }
}

export async function collectWorkingTreeFiles(
  owner: string,
  repo: string,
): Promise<Map<string, Uint8Array>> {
  const root = githubRepoRootPath(owner, repo)
  const rootStat = await filesStat(root)
  if (!rootStat) return new Map()

  const entries = await listFilesRecursive(root)
  const map = new Map<string, Uint8Array>()
  const prefix = `${root}/`
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue
    const relative = entry.path.slice(prefix.length)
    if (!relative) continue
    map.set(relative, await readWorkingTreeBytes(entry.path))
  }
  return map
}

/** 仅收集工作区相对路径与 byteSize，不读正文 */
export async function collectWorkingTreeFileStats(
  owner: string,
  repo: string,
): Promise<Map<string, { absolutePath: string; byteSize: number }>> {
  const root = githubRepoRootPath(owner, repo)
  const rootStat = await filesStat(root)
  if (!rootStat) return new Map()

  const entries = await listFilesRecursive(root)
  const map = new Map<string, { absolutePath: string; byteSize: number }>()
  const prefix = `${root}/`
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue
    const relative = entry.path.slice(prefix.length)
    if (!relative) continue
    map.set(relative, { absolutePath: entry.path, byteSize: entry.byteSize })
  }
  return map
}

/**
 * 按 fileIndex diff 操作增量更新工作区：只删/写有差异的路径，不清空整树。
 * upsert：并发预取基线后批量写入；remove：逐个删除。
 */
export async function applyFileIndexOpsToWorkingTree(
  owner: string,
  repo: string,
  ops: readonly GithubFileIndexOp[],
  onProgress?: GithubProgress,
): Promise<void> {
  if (ops.length === 0) {
    onProgress?.('工作区已对齐')
    return
  }

  const repoPath = await ensureRepoRootFolder(owner, repo)
  const removes = ops.filter((op) => op.kind === 'remove')
  const upserts = ops.filter((op) => op.kind === 'upsert')

  let totalUpsertBytes = 0
  for (const op of upserts) {
    totalUpsertBytes += op.byteSize
  }
  if (totalUpsertBytes > 0) {
    await assertAdditionalBytesAvailable(totalUpsertBytes + upserts.length * 64)
  }

  let applied = 0
  let lastProgressAt = 0
  const progressIntervalMs = 1000
  const total = ops.length
  const report = () => {
    const now = osNowMs()
    if (applied === total || shouldReportGithubProgress(lastProgressAt, now, progressIntervalMs)) {
      lastProgressAt = now
      onProgress?.(`同步文件 ${applied}/${total}…`, {
        fraction: total > 0 ? applied / total : undefined,
      })
    }
  }

  for (const op of removes) {
    const absolute = joinFilesAbsolutePath(repoPath, ...op.path.split('/'))
    await removeWorkingTreePath(absolute)
    applied += 1
    report()
  }

  if (upserts.length > 0) {
    onProgress?.(`预取基线 ${upserts.length} 个文件…`)
    const payloads = await mapWithConcurrency(
      upserts,
      BASELINE_PREFETCH_CONCURRENCY,
      async (op) => {
        const bytes = await readBaselineBytes(op.hash)
        if (bytes === undefined) {
          throw new Error(`缺少基线快照：${op.path}`)
        }
        const absolute = joinFilesAbsolutePath(repoPath, ...op.path.split('/'))
        return toUpsertBatchItem(absolute, bytes)
      },
    )
    onProgress?.(`批量写入 ${payloads.length} 个文件…`)
    await filesUpsertBatch(payloads)
    applied += upserts.length
    report()
  }

  onProgress?.(`已同步 ${ops.length} 个文件`)
}

/** 将工作区从 fromIndex 对齐到 toIndex（仅应用差异） */
export async function syncWorkingTreeToFileIndex(
  owner: string,
  repo: string,
  fromIndex: Record<string, GithubFileIndexEntry>,
  toIndex: Record<string, GithubFileIndexEntry>,
  onProgress?: GithubProgress,
): Promise<number> {
  const ops = diffFileIndexes(fromIndex, toIndex)
  onProgress?.(
    ops.length === 0 ? '工作区无需变更' : `应用 ${ops.length} 处差异…`,
  )
  await applyFileIndexOpsToWorkingTree(owner, repo, ops, onProgress)
  return ops.length
}

export async function materializeFilesToRepo(
  owner: string,
  repo: string,
  files: Map<string, Uint8Array>,
  onProgress?: GithubProgress,
): Promise<void> {
  const repoPath = await ensureRepoRootFolder(owner, repo)
  onProgress?.('清理本地工作树…')
  await clearDirectoryContents(repoPath)

  let totalBytes = 0
  for (const bytes of files.values()) {
    totalBytes += bytes.byteLength
  }
  await assertAdditionalBytesAvailable(totalBytes + files.size * 64)

  const payloads: FilesUpsertBatchItem[] = []
  for (const [relativePath, bytes] of files) {
    const absolute = joinFilesAbsolutePath(repoPath, ...relativePath.split('/'))
    payloads.push(toUpsertBatchItem(absolute, bytes))
  }
  onProgress?.(`批量写入 ${payloads.length} 个文件…`, {
    fraction: payloads.length > 0 ? 0.2 : 1,
  })
  await filesUpsertBatch(payloads)
  onProgress?.(`已写入 ${files.size} 个文件`, { fraction: 1 })
}

export async function unzipGithubZipball(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const unzipped = unzipSync(new Uint8Array(buffer))
  return stripZipRoot(unzipped)
}

export async function cloneGithubRepository(params: {
  owner: string
  repo: string
  branch?: string
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const onProgress = params.onProgress
  onProgress?.('读取仓库信息…')
  const remote = await githubGetRepo(params.owner, params.repo)
  const branch = params.branch?.trim() || remote.defaultBranch

  onProgress?.(`下载 ${branch} 分支压缩包…`)
  const zip = await githubDownloadZipball(params.owner, params.repo, branch, onProgress)
  onProgress?.('解析压缩包…')
  const files = await unzipGithubZipball(zip)

  onProgress?.('获取提交 SHA…')
  const headSha = await githubGetBranchTip(params.owner, params.repo, branch)

  await materializeFilesToRepo(params.owner, params.repo, files, onProgress)

  onProgress?.('建立同步快照…')
  const working = await collectWorkingTreeFiles(params.owner, params.repo)
  const fileIndex = await persistBaselineFromFiles(working)
  const meta: GithubRepoSyncMeta = {
    version: 2,
    owner: remote.owner.login,
    repo: remote.name,
    currentBranch: branch,
    defaultBranch: remote.defaultBranch,
    branches: {
      [branch]: { tipSha: headSha, fileIndex },
    },
    updatedAt: osNowMs(),
    remote: stampGithubStoredRemoteRepo(remote),
  }
  await saveGithubRepoMeta(meta)
  return meta
}

export async function deleteLocalGithubRepository(owner: string, repo: string): Promise<void> {
  const repoPath = githubRepoRootPath(owner, repo)
  const node = await resolveNodeByAbsolutePath(repoPath)
  if (node) {
    await deleteGithubNodeSubtree(node)
  }
  const ownerPath = joinFilesAbsolutePath('/repo/github', owner)
  const ownerNode = await resolveNodeByAbsolutePath(ownerPath)
  if (ownerNode) {
    const ownerChildren = await listChildNodes('repo', ownerNode.id).catch(() => [])
    if (ownerChildren.length === 0) {
      await deleteGithubNodeSubtree(ownerNode).catch(() => undefined)
    }
  }
}

/** 本地工作树目录是否还在（对齐 Desktop 判断 missing） */
export async function isGithubRepoWorkingTreePresent(
  owner: string,
  repo: string,
): Promise<boolean> {
  const root = githubRepoRootPath(owner, repo)
  const stat = await filesStat(root)
  return Boolean(stat)
}

/**
 * 克隆前检查目标路径是否可用（首次从对话框克隆）。
 * 返回阻止克隆的说明；undefined 表示可以克隆。
 */
export async function describeGithubRepoClonePathBlockReason(
  owner: string,
  repo: string,
): Promise<string | undefined> {
  const path = githubRepoRootPath(owner, repo)
  const meta = await getGithubRepoMeta(owner, repo)
  const rootStat = await filesStat(path)

  if (rootStat && rootStat.kind !== 'folder') {
    return `目标路径 ${path} 已被非文件夹占用，无法克隆。`
  }

  const children = rootStat?.kind === 'folder' ? await filesList(path) : []
  const hasContent = children.length > 0

  if (meta && !meta.missing && hasContent) {
    return `本地已有 ${owner}/${repo}（${path}），无需重复克隆。`
  }

  if (hasContent) {
    return `目标文件夹 ${path} 不为空，无法克隆到此位置。请先删除本地副本，或使用「重新克隆」。`
  }

  return undefined
}

/** 重新克隆：仅拒绝路径被非文件夹占用；已有内容会在克隆流程中清空覆写 */
export async function describeGithubRepoReclonePathBlockReason(
  owner: string,
  repo: string,
): Promise<string | undefined> {
  const path = githubRepoRootPath(owner, repo)
  const rootStat = await filesStat(path)
  if (rootStat && rootStat.kind !== 'folder') {
    return `目标路径 ${path} 已被非文件夹占用，无法重新克隆。`
  }
  return undefined
}
