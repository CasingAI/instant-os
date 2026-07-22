import { joinFilesAbsolutePath } from '../files/files-path.ts'
import {
  baselineMissingForIndex,
  loadFilesFromFileIndex,
  readBaselineBytes,
} from './github-baseline.ts'
import type { GithubChange } from './github-changes.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import { currentFileIndex, type GithubRepoSyncMeta } from './github-sync-meta.ts'
import type { GithubProgress } from './github-progress.ts'
import {
  materializeFilesToRepo,
  removeWorkingTreePath,
  writeWorkingTreeFile,
} from './github-working-tree.ts'

const MISSING_BASELINE_MESSAGE =
  '本地基线不完整，无法丢弃更改。请使用菜单「仓库 → 重建本地基线」或重新克隆。'

async function assertBaselineReady(
  fileIndex: Record<string, { hash: string }>,
): Promise<void> {
  if (Object.keys(fileIndex).length === 0) {
    throw new Error('当前分支没有本地快照，无法丢弃更改。请先拉取或重新克隆。')
  }
  if (await baselineMissingForIndex(fileIndex)) {
    throw new Error(MISSING_BASELINE_MESSAGE)
  }
}

/** 将指定变更从工作区还原为当前分支 tip 基线 */
export async function discardGithubChanges(params: {
  meta: GithubRepoSyncMeta
  changes: readonly GithubChange[]
  /** true：整工作区对齐 tip（清空多余新增文件）；false：仅处理列出的变更 */
  discardAll: boolean
  onProgress?: GithubProgress
}): Promise<void> {
  const { meta, changes, discardAll, onProgress } = params
  if (changes.length === 0) return

  const fileIndex = currentFileIndex(meta)
  await assertBaselineReady(fileIndex)

  if (discardAll) {
    onProgress?.('正在还原工作区…')
    const files = await loadFilesFromFileIndex(fileIndex)
    if (!files) {
      throw new Error(MISSING_BASELINE_MESSAGE)
    }
    await materializeFilesToRepo(meta.owner, meta.repo, files, onProgress)
    return
  }

  const root = githubRepoRootPath(meta.owner, meta.repo)
  for (const change of changes) {
    if (change.kind === 'added') {
      await removeWorkingTreePath(change.absolutePath)
      continue
    }
    const entry = fileIndex[change.path]
    if (!entry) {
      throw new Error(`无法丢弃 ${change.path}：缺少基线索引`)
    }
    const bytes = await readBaselineBytes(entry.hash)
    if (bytes === undefined) {
      throw new Error(`无法丢弃 ${change.path}：缺少基线快照`)
    }
    const absolute =
      change.absolutePath || joinFilesAbsolutePath(root, ...change.path.split('/'))
    await writeWorkingTreeFile(absolute, bytes)
  }
}
