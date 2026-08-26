import { joinFilesAbsolutePath } from '../files/files-path.ts'
import {
  baselineBlobsAbsentForIndex,
  readBaselineBytes,
} from './github-baseline.ts'
import type { GithubChange } from './github-changes.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import {
  currentFileIndex,
  currentHeadSha,
  saveGithubRepoMeta,
  withBranchSnapshot,
  type GithubFileIndexEntry,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import { shouldReportGithubProgress, type GithubProgress } from './github-progress.ts'
import { osNowMs } from '../../os/os-clock.ts'
import {
  writeWorkingTreeFile,
} from './github-working-tree.ts'
import { filesRemoveBatch } from '../files/files-api.ts'

const MISSING_BASELINE_MESSAGE =
  '本地基线不完整，无法丢弃更改。请使用菜单「仓库 → 重建本地基线」或重新克隆。'

async function assertBaselineReady(
  fileIndex: Record<string, GithubFileIndexEntry>,
): Promise<void> {
  if (Object.keys(fileIndex).length === 0) {
    throw new Error('当前分支没有本地快照，无法丢弃更改。请先拉取或重新克隆。')
  }
  if (await baselineBlobsAbsentForIndex(fileIndex)) {
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
}): Promise<GithubRepoSyncMeta> {
  const { meta, changes, onProgress } = params
  if (changes.length === 0) return meta

  const fileIndex = currentFileIndex(meta)
  await assertBaselineReady(fileIndex)

  const root = githubRepoRootPath(meta.owner, meta.repo)
  let applied = 0
  let lastProgressAt = 0
  const progressIntervalMs = 1000
  onProgress?.(
    params.discardAll ? '正在还原工作区…' : `丢弃 ${changes.length} 处更改…`,
  )

  const addedPaths: string[] = []
  const restoreChanges: GithubChange[] = []

  for (const change of changes) {
    if (change.kind === 'added') {
      addedPaths.push(change.absolutePath)
    } else {
      restoreChanges.push(change)
    }
  }

  if (addedPaths.length > 0) {
    await filesRemoveBatch(addedPaths, { skipMissing: true })
    applied += addedPaths.length
    const now = osNowMs()
    if (
      applied === changes.length ||
      shouldReportGithubProgress(lastProgressAt, now, progressIntervalMs)
    ) {
      lastProgressAt = now
      onProgress?.(`还原文件 ${applied}/${changes.length}…`, {
        fraction: applied / changes.length,
      })
    }
  }

  for (const change of restoreChanges) {
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
    applied += 1
    const now = osNowMs()
    if (
      applied === changes.length ||
      shouldReportGithubProgress(lastProgressAt, now, progressIntervalMs)
    ) {
      lastProgressAt = now
      onProgress?.(`还原文件 ${applied}/${changes.length}…`, {
        fraction: applied / changes.length,
      })
    }
  }

  // 写回 tip 内容与基线 hash 一致，纯 hash 检测不会误报
  const next = withBranchSnapshot(meta, meta.currentBranch, {
    tipSha: currentHeadSha(meta),
    fileIndex,
  })
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)

  onProgress?.(`已还原 ${changes.length} 个文件`)
  return next
}
