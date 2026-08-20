import type { GithubFileIndexEntry } from './github-sync-meta.ts'

export type GithubFileIndexRemoveOp = {
  kind: 'remove'
  path: string
}

export type GithubFileIndexUpsertOp = {
  kind: 'upsert'
  path: string
  hash: string
  byteSize: number
}

export type GithubFileIndexOp = GithubFileIndexRemoveOp | GithubFileIndexUpsertOp

/**
 * 对比两个 fileIndex，产出仅需应用到工作区的操作。
 * - 仅在 from 中：remove
 * - 仅在 to 中，或 hash 变化：upsert
 * - 同路径同 hash：跳过
 */
export function diffFileIndexes(
  from: Record<string, GithubFileIndexEntry>,
  to: Record<string, GithubFileIndexEntry>,
): GithubFileIndexOp[] {
  const ops: GithubFileIndexOp[] = []

  for (const path of Object.keys(from)) {
    if (!to[path]) {
      ops.push({ kind: 'remove', path })
    }
  }

  for (const [path, entry] of Object.entries(to)) {
    const previous = from[path]
    if (!previous || previous.hash !== entry.hash) {
      ops.push({
        kind: 'upsert',
        path,
        hash: entry.hash,
        byteSize: entry.byteSize,
      })
    }
  }

  ops.sort((a, b) => a.path.localeCompare(b.path))
  return ops
}
