import { osNowMs } from '../../os/os-clock.ts'
import { filesBackfillSubtreeContentRevisionIds, filesReadText } from '../files/files-api.ts'
import { githubDownloadZipball } from './github-api.ts'
import {
  baselineBlobExists,
  baselineBlobsAbsentForIndex,
  readBaselineBytes,
  readBaselineTextForPath,
  writeBaselineBlob,
  writeBaselineBlobIfMissing,
} from './github-baseline.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import { diffRevisionSnapshot, fileIndexHasAnyRevisionId } from './github-revision-diff.ts'
import {
  buildFileIndex,
  buildFileIndexFromRevisionSnapshot,
  currentFileIndex,
  currentHeadSha,
  hashBytes,
  reconcileFileIndexRevisionIds,
  saveGithubRepoMeta,
  withBranchSnapshot,
  type GithubFileIndexEntry,
  type GithubRepoSyncMeta,
  type GithubRevisionSnapshotEntry,
} from './github-sync-meta.ts'
import type { GithubProgress } from './github-progress.ts'
import {
  collectWorkingTreeFiles,
  collectWorkingTreeFileStats,
  collectWorkingTreeRevisionSnapshot,
  isProbablyTextBytes,
  readWorkingTreeBytes,
  unzipGithubZipball,
} from './github-working-tree.ts'

export type GithubChangeKind = 'added' | 'modified' | 'deleted'

export type GithubChange = {
  path: string
  kind: GithubChangeKind
  absolutePath: string
}

/** Monaco Diff 用的两侧正文；notice 有值时表示无法做文本 diff，只展示提示 */
export type GithubChangePreview = {
  path: string
  original: string
  modified: string
  notice?: string
}

export {
  collectWorkingTreeFiles,
  collectWorkingTreeFileStats,
  collectWorkingTreeRevisionSnapshot,
  readWorkingTreeBytes,
}

export async function detectGithubChanges(
  meta: GithubRepoSyncMeta,
): Promise<GithubChange[]> {
  const root = githubRepoRootPath(meta.owner, meta.repo)
  const snapshot = await collectWorkingTreeRevisionSnapshot(meta.owner, meta.repo)
  const fileIndex = currentFileIndex(meta)
  const provisional = diffRevisionSnapshot(fileIndex, snapshot, root)
  const changes: GithubChange[] = []

  for (const item of provisional) {
    if (!item.needsHashCheck) {
      changes.push({
        path: item.path,
        kind: item.kind,
        absolutePath: item.absolutePath,
      })
      continue
    }

    // 缺 revisionId：回退 size / hash
    const previous = fileIndex[item.path]
    if (!previous) {
      changes.push({
        path: item.path,
        kind: 'added',
        absolutePath: item.absolutePath,
      })
      continue
    }
    if (previous.byteSize !== item.byteSize) {
      changes.push({
        path: item.path,
        kind: 'modified',
        absolutePath: item.absolutePath,
      })
      continue
    }
    const bytes = await readWorkingTreeBytes(item.absolutePath)
    const hash = await hashBytes(bytes)
    if (previous.hash !== hash) {
      changes.push({
        path: item.path,
        kind: 'modified',
        absolutePath: item.absolutePath,
      })
    }
  }

  return changes
}

/**
 * 从当前工作区构建 fileIndex（含 revisionId），并写入缺失的 baseline blob。
 * hash 优先复用 previousIndex 中 revisionId 未变的路径。
 */
export async function persistBaselineFromWorkingTree(
  owner: string,
  repo: string,
  previousIndex?: Record<string, GithubFileIndexEntry>,
): Promise<Record<string, GithubFileIndexEntry>> {
  const snapshot = await collectWorkingTreeRevisionSnapshot(owner, repo)
  return buildFileIndexFromRevisionSnapshot(snapshot, {
    previousIndex,
    hashPath: async (absolutePath) => {
      const bytes = await readWorkingTreeBytes(absolutePath)
      const hash = await hashBytes(bytes)
      await writeBaselineBlobIfMissing(hash, bytes)
      return { hash, byteSize: bytes.byteLength }
    },
  })
}

/**
 * 将已有 fileIndex 的 revisionId 与当前工作区节点对齐（discard / zip 物化后）。
 */
export async function stampFileIndexRevisionIdsFromWorkingTree(
  owner: string,
  repo: string,
  fileIndex: Record<string, GithubFileIndexEntry>,
  paths?: ReadonlySet<string>,
): Promise<Record<string, GithubFileIndexEntry>> {
  const snapshot = await collectWorkingTreeRevisionSnapshot(owner, repo)
  return reconcileFileIndexRevisionIds(fileIndex, snapshot, paths)
}

export { reconcileFileIndexRevisionIds }
export type { GithubRevisionSnapshotEntry }

/**
 * 打开仓库时：补齐节点 contentRevisionId；若工作区干净且 fileIndex 缺 revisionId，则写入 fileIndex。
 * 有本地变更时不 stamp fileIndex，继续靠 hash 回退直到 commit/discard。
 */
export async function ensureGithubRevisionIdsReady(
  meta: GithubRepoSyncMeta,
  onProgress?: GithubProgress,
): Promise<GithubRepoSyncMeta> {
  const root = githubRepoRootPath(meta.owner, meta.repo)
  onProgress?.('补齐文件版本戳…')
  try {
    await filesBackfillSubtreeContentRevisionIds(root)
  } catch {
    // 根目录不存在等：跳过
    return meta
  }

  const fileIndex = currentFileIndex(meta)
  if (Object.keys(fileIndex).length === 0) return meta
  if (fileIndexHasAnyRevisionId(fileIndex)) return meta

  // fileIndex 全无 revisionId：先用 hash 检测是否干净
  const changes = await detectGithubChanges(meta)
  if (changes.length > 0) return meta

  onProgress?.('同步版本戳到索引…')
  const stamped = await stampFileIndexRevisionIdsFromWorkingTree(
    meta.owner,
    meta.repo,
    fileIndex,
  )
  const next = withBranchSnapshot(meta, meta.currentBranch, {
    tipSha: currentHeadSha(meta),
    fileIndex: stamped,
  })
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  return next
}

export type RebuildBaselineResult =
  | { status: 'rebuilt'; written: number; fromRemote: number; repaired: number }
  | { status: 'already_complete' }
  | { status: 'empty' }
  | { status: 'incomplete'; written: number; missing: number }

/**
 * 重建当前分支 tip 的本地 blob。
 * - 默认：仅按存在性检查缺失对象；工作区干净时可就地补齐，**绝不请求网络、不做全量 hash**。
 * - force（菜单「重建本地基线」）：一次 zipball 重写 baseline + fileIndex，不动工作区。
 */
export async function rebuildGithubBaseline(
  meta: GithubRepoSyncMeta,
  options?: { hasLocalChanges?: boolean; force?: boolean; onProgress?: GithubProgress },
): Promise<RebuildBaselineResult> {
  const fileIndex = currentFileIndex(meta)
  if (Object.keys(fileIndex).length === 0 && !options?.force) return { status: 'empty' }

  if (options?.force) {
    return forceRebuildBaselineFromZip(meta, options.onProgress)
  }

  options?.onProgress?.('检查基线对象是否齐全…')
  if (!(await baselineBlobsAbsentForIndex(fileIndex))) {
    return { status: 'already_complete' }
  }

  const hasLocalChanges =
    options?.hasLocalChanges ?? (await detectGithubChanges(meta)).length > 0

  let written = 0

  // 有本地变更时不能拿工作区当 tip；缺的基线留给用户手动「重建」
  if (!hasLocalChanges) {
    const working = await collectWorkingTreeFiles(meta.owner, meta.repo)
    const currentIndex = await buildFileIndex(working)
    let matchesTip = true
    const allPaths = new Set([...Object.keys(fileIndex), ...Object.keys(currentIndex)])
    for (const path of allPaths) {
      const expected = fileIndex[path]
      const actual = currentIndex[path]
      if (!expected || !actual || expected.hash !== actual.hash) {
        matchesTip = false
        break
      }
    }
    if (matchesTip) {
      for (const [path, bytes] of working) {
        const hash = fileIndex[path]?.hash
        if (!hash || (await baselineBlobExists(hash))) continue
        await writeBaselineBlob(hash, bytes)
        written += 1
      }
    }
  }

  if (!(await baselineBlobsAbsentForIndex(fileIndex))) {
    return { status: 'rebuilt', written, fromRemote: 0, repaired: 0 }
  }
  if (written > 0) {
    return {
      status: 'incomplete',
      written,
      missing: await countMissingBlobs(fileIndex),
    }
  }
  return { status: 'incomplete', written: 0, missing: await countMissingBlobs(fileIndex) }
}

/** 一次 zipball 重建 tip 基线；不改写工作区（本地未提交改动得以保留） */
async function forceRebuildBaselineFromZip(
  meta: GithubRepoSyncMeta,
  onProgress?: GithubProgress,
): Promise<RebuildBaselineResult> {
  const tipSha = currentHeadSha(meta)
  if (!tipSha) return { status: 'empty' }

  onProgress?.('下载压缩包…')
  const zip = await githubDownloadZipball(meta.owner, meta.repo, tipSha, onProgress)
  onProgress?.('解压压缩包…')
  const files = await unzipGithubZipball(zip)
  if (files.size === 0) return { status: 'empty' }

  let written = 0
  const nextIndex: Record<string, GithubFileIndexEntry> = {}
  const entries = [...files.entries()]
  const total = entries.length
  for (const [path, bytes] of entries) {
    const hash = await hashBytes(bytes)
    await writeBaselineBlob(hash, bytes)
    nextIndex[path] = { hash, byteSize: bytes.byteLength }
    written += 1
    if (written % 50 === 0 || written === total) {
      onProgress?.(`写入基线快照 ${written} / ${total}`, { fraction: written / total })
    }
  }

  const next = withBranchSnapshot(meta, meta.currentBranch, {
    tipSha,
    fileIndex: nextIndex,
  })
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)

  return { status: 'rebuilt', written, fromRemote: written, repaired: 0 }
}

async function countMissingBlobs(
  fileIndex: Record<string, { hash: string }>,
): Promise<number> {
  let missing = 0
  for (const entry of Object.values(fileIndex)) {
    if (!(await baselineBlobExists(entry.hash))) missing += 1
  }
  return missing
}

async function readPathAsText(absolutePath: string): Promise<string> {
  try {
    return await filesReadText(absolutePath)
  } catch {
    const bytes = await readWorkingTreeBytes(absolutePath)
    if (!isProbablyTextBytes(bytes)) {
      return `（二进制文件，${bytes.byteLength} 字节）\n`
    }
    return new TextDecoder().decode(bytes)
  }
}

const MISSING_BASELINE_NOTICE =
  '本地没有该文件的基线快照。请使用菜单「仓库 → 重建本地基线」（需代理）补齐。'

/** 变更预览：只读本地 tip blob vs 工作区。切勿再调 Contents API 当「旧版」——易把 JSON 包装当成原文。 */
export async function buildChangePreview(
  meta: GithubRepoSyncMeta,
  change: GithubChange,
): Promise<GithubChangePreview> {
  const fileIndex = currentFileIndex(meta)

  if (change.kind === 'added') {
    const text = await readPathAsText(change.absolutePath)
    if (text.startsWith('（二进制文件')) {
      return {
        path: change.path,
        original: '',
        modified: '',
        notice: `二进制文件已新增：${text.trim()}`,
      }
    }
    return { path: change.path, original: '', modified: text }
  }

  const entry = fileIndex[change.path]
  if (!entry || !(await baselineBlobExists(entry.hash))) {
    if (change.kind === 'deleted') {
      return {
        path: change.path,
        original: '',
        modified: '',
        notice: MISSING_BASELINE_NOTICE,
      }
    }
    const newText = await readPathAsText(change.absolutePath)
    return {
      path: change.path,
      original: '',
      modified: newText.startsWith('（二进制文件') ? '' : newText,
      notice: MISSING_BASELINE_NOTICE,
    }
  }

  if (change.kind === 'deleted') {
    const oldText = await readBaselineTextForPath(fileIndex, change.path)
    if (oldText === undefined) {
      const bytes = await readBaselineBytes(entry.hash)
      return {
        path: change.path,
        original: '',
        modified: '',
        notice: bytes
          ? `二进制文件已删除（${bytes.byteLength} 字节）`
          : MISSING_BASELINE_NOTICE,
      }
    }
    return { path: change.path, original: oldText, modified: '' }
  }

  const newText = await readPathAsText(change.absolutePath)
  if (newText.startsWith('（二进制文件')) {
    return {
      path: change.path,
      original: '',
      modified: '',
      notice: `二进制文件已修改：${newText.trim()}`,
    }
  }

  const oldText = await readBaselineTextForPath(fileIndex, change.path)
  if (oldText === undefined) {
    const bytes = await readBaselineBytes(entry.hash)
    return {
      path: change.path,
      original: '',
      modified: newText,
      notice: bytes
        ? '旧版为二进制，以下为当前文件全文。'
        : MISSING_BASELINE_NOTICE,
    }
  }

  return { path: change.path, original: oldText, modified: newText }
}
