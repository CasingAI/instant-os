import type {
  GithubFileIndexEntry,
  GithubRevisionSnapshotEntry,
} from './github-sync-meta.ts'

export type GithubRevisionChangeKind = 'added' | 'modified' | 'deleted'

export type GithubRevisionChange = {
  path: string
  kind: GithubRevisionChangeKind
  absolutePath: string
  /** true：需读 blob 算 hash 才能确认（缺 revisionId 时） */
  needsHashCheck: boolean
  byteSize?: number
}

/**
 * 纯元数据对比：revisionId 相同则未变更；双方都有且不等则 modified；
 * 任一方缺 revisionId 则标记 needsHashCheck（由调用方回退）。
 */
export function diffRevisionSnapshot(
  fileIndex: Record<string, GithubFileIndexEntry>,
  working: readonly GithubRevisionSnapshotEntry[],
  rootAbsolutePath: string,
): GithubRevisionChange[] {
  const changes: GithubRevisionChange[] = []
  const workingPaths = new Set<string>()

  for (const entry of working) {
    workingPaths.add(entry.path)
    const previous = fileIndex[entry.path]
    if (!previous) {
      changes.push({
        path: entry.path,
        kind: 'added',
        absolutePath: entry.absolutePath,
        needsHashCheck: false,
        byteSize: entry.byteSize,
      })
      continue
    }

    const prevRev = previous.revisionId
    const liveRev = entry.contentRevisionId
    if (prevRev !== undefined && liveRev !== undefined) {
      if (prevRev === liveRev) continue
      changes.push({
        path: entry.path,
        kind: 'modified',
        absolutePath: entry.absolutePath,
        needsHashCheck: false,
        byteSize: entry.byteSize,
      })
      continue
    }

    // 缺 revisionId：回退给调用方做 size / hash 检查
    changes.push({
      path: entry.path,
      kind: 'modified',
      absolutePath: entry.absolutePath,
      needsHashCheck: true,
      byteSize: entry.byteSize,
    })
  }

  for (const path of Object.keys(fileIndex)) {
    if (workingPaths.has(path)) continue
    const absolutePath = rootAbsolutePath.endsWith('/')
      ? `${rootAbsolutePath}${path}`
      : `${rootAbsolutePath}/${path}`
    changes.push({
      path,
      kind: 'deleted',
      absolutePath,
      needsHashCheck: false,
    })
  }

  changes.sort((a, b) => a.path.localeCompare(b.path))
  return changes
}

/** fileIndex 是否已有任意 revisionId（用于判断是否需要遗留 backfill） */
export function fileIndexHasAnyRevisionId(
  fileIndex: Record<string, GithubFileIndexEntry>,
): boolean {
  for (const entry of Object.values(fileIndex)) {
    if (entry.revisionId !== undefined) return true
  }
  return false
}
