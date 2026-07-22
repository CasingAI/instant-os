import { osNowMs } from '../../os/os-clock.ts'
import { filesReadText } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { githubDownloadZipball } from './github-api.ts'
import {
  baselineBlobExists,
  baselineBlobIsValid,
  baselineMissingForIndex,
  readBaselineBytes,
  readBaselineTextForPath,
  removeBaselineBlob,
  writeBaselineBlob,
} from './github-baseline.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import {
  buildFileIndex,
  currentFileIndex,
  currentHeadSha,
  hashBytes,
  saveGithubRepoMeta,
  withBranchSnapshot,
  type GithubFileIndexEntry,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import type { GithubProgress } from './github-progress.ts'
import {
  collectWorkingTreeFiles,
  collectWorkingTreeFileStats,
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

export { collectWorkingTreeFiles, collectWorkingTreeFileStats, readWorkingTreeBytes }

export async function detectGithubChanges(
  meta: GithubRepoSyncMeta,
): Promise<GithubChange[]> {
  const root = githubRepoRootPath(meta.owner, meta.repo)
  const workingStats = await collectWorkingTreeFileStats(meta.owner, meta.repo)
  const fileIndex = currentFileIndex(meta)
  const changes: GithubChange[] = []

  for (const [path, stat] of workingStats) {
    const previous = fileIndex[path]
    if (!previous) {
      changes.push({ path, kind: 'added', absolutePath: stat.absolutePath })
      continue
    }
    // 大小不同即可判定修改，跳过读正文与哈希
    if (previous.byteSize !== stat.byteSize) {
      changes.push({ path, kind: 'modified', absolutePath: stat.absolutePath })
      continue
    }
    // 大小相同：读正文算哈希，排除「同大小不同内容」
    const bytes = await readWorkingTreeBytes(stat.absolutePath)
    const hash = await hashBytes(bytes)
    if (previous.hash !== hash) {
      changes.push({ path, kind: 'modified', absolutePath: stat.absolutePath })
    }
  }

  for (const path of Object.keys(fileIndex)) {
    if (!workingStats.has(path)) {
      changes.push({
        path,
        kind: 'deleted',
        absolutePath: joinFilesAbsolutePath(root, ...path.split('/')),
      })
    }
  }

  changes.sort((a, b) => a.path.localeCompare(b.path))
  return changes
}

/**
 * 已有仓库可能只有 fileIndex、没有 blob。
 * 在无本地变更时，工作区即基线，可就地补齐。
 */
export async function ensureBaselineIfClean(
  meta: GithubRepoSyncMeta,
  hasLocalChanges: boolean,
  onProgress?: GithubProgress,
): Promise<void> {
  await rebuildGithubBaseline(meta, { hasLocalChanges, onProgress })
}

export type RebuildBaselineResult =
  | { status: 'rebuilt'; written: number; fromRemote: number; repaired: number }
  | { status: 'already_complete' }
  | { status: 'empty' }
  | { status: 'incomplete'; written: number; missing: number }

/**
 * 重建当前分支 tip 的本地 blob。
 * - 默认（打开仓库 / 文件监听）：只做本地补齐与脏 blob 清理，**绝不请求网络**。
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

  options?.onProgress?.('检查基线快照是否完整…')
  if (!(await baselineMissingForIndex(fileIndex))) {
    return { status: 'already_complete' }
  }

  const hasLocalChanges =
    options?.hasLocalChanges ?? (await detectGithubChanges(meta)).length > 0

  let written = 0
  let repaired = 0

  // 先清掉内容与 key 不符的脏 blob，否则占坑会导致误判「已完整」
  for (const entry of Object.values(fileIndex)) {
    if (await baselineBlobExists(entry.hash) && !(await baselineBlobIsValid(entry.hash))) {
      await removeBaselineBlob(entry.hash)
      repaired += 1
    }
  }

  // 有本地变更时不能拿工作区当 tip；缺的基线留给用户手动「重建」或干净后补齐
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
        if (!hash || (await baselineBlobIsValid(hash))) continue
        await writeBaselineBlob(hash, bytes)
        written += 1
      }
    }
  }

  if (!(await baselineMissingForIndex(fileIndex))) {
    return { status: 'rebuilt', written, fromRemote: 0, repaired }
  }
  if (written > 0 || repaired > 0) {
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
    if (!(await baselineBlobIsValid(entry.hash))) missing += 1
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
  '本地没有该文件的基线快照。请使用菜单「仓库 → 重建本地基线」（需代理）补齐，或在干净工作区时重新打开仓库。'

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
