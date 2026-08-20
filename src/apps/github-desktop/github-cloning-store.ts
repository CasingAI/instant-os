import {
  cloneGithubRepository,
} from './github-working-tree.ts'
import type { GithubProgress } from './github-progress.ts'
import type { GithubRepoSyncMeta } from './github-sync-meta.ts'

export type GithubCloningRepository = {
  id: number
  owner: string
  repo: string
}

type Listener = () => void

/** 对齐 Desktop：自 1_000_000 起，避免与持久化仓库 id 冲突 */
let nextId = 1_000_000
const repositories: GithubCloningRepository[] = []
const progressById = new Map<number, { label: string; fraction?: number }>()
const listeners = new Set<Listener>()

function notifySubscribers() {
  for (const listener of listeners) {
    listener()
  }
}

export function listGithubCloningRepositories(): readonly GithubCloningRepository[] {
  return repositories.slice()
}

export function getGithubCloningRepository(
  id: number,
): GithubCloningRepository | undefined {
  return repositories.find((entry) => entry.id === id)
}

export function getGithubCloningProgress(id: number): string | undefined {
  return progressById.get(id)?.label
}

export function getGithubCloningProgressFraction(id: number): number | undefined {
  return progressById.get(id)?.fraction
}

export function subscribeGithubCloningRepositories(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 从 UI 列表摘掉正在克隆的项（对齐 Desktop Remove）。
 * 不中止底层下载/写入；任务仍可能跑完并写入本地元数据。
 */
export function removeGithubCloningRepository(id: number): void {
  const index = repositories.findIndex((entry) => entry.id === id)
  if (index < 0) return
  repositories.splice(index, 1)
  progressById.delete(id)
  notifySubscribers()
}

function setProgress(id: number, label: string, fraction?: number) {
  if (!progressById.has(id) && !repositories.some((entry) => entry.id === id)) {
    return
  }
  const previous = progressById.get(id)?.fraction
  const nextFraction =
    fraction === undefined
      ? previous
      : previous === undefined
        ? fraction
        : Math.max(previous, fraction)
  progressById.set(id, { label, fraction: nextFraction })
  notifySubscribers()
}

/** 将各阶段进度映射到 0–1 总进度；无明细时也返回阶段基线，避免 indeterminate 循环条。 */
function resolveCloneOverallFraction(message: string, detailFraction?: number): number {
  if (detailFraction === undefined) {
    const match = /(\d+)\s*\/\s*(\d+)/.exec(message)
    if (match) {
      const done = Number(match[1])
      const total = Number(match[2])
      if (total > 0) detailFraction = done / total
    }
  }

  if (message.includes('读取仓库信息')) return 0.06
  if (message.includes('建立同步快照')) return 0.96
  if (message.includes('获取 commit SHA')) return 0.66
  if (message.includes('解析压缩包') || message.includes('解压')) return 0.62
  if (message.includes('清理本地工作树')) return 0.68

  if (
    message.includes('写入') ||
    message.includes('批量写入') ||
    message.includes('已写入')
  ) {
    const stage = detailFraction ?? 0.2
    return 0.7 + stage * 0.25
  }

  if (message.includes('下载') || message.includes('压缩包')) {
    const stage = detailFraction ?? 0
    return 0.1 + stage * 0.5
  }

  return detailFraction ?? 0.08
}

/**
 * 启动后台克隆。返回临时仓库与 promise。
 * 成功/失败都会从列表移除临时项（对齐 CloningRepositoriesStore.clone）。
 */
export function startGithubClone(params: {
  owner: string
  repo: string
}): {
  repository: GithubCloningRepository
  promise: Promise<GithubRepoSyncMeta>
} {
  const repository: GithubCloningRepository = {
    id: nextId++,
    owner: params.owner,
    repo: params.repo,
  }
  repositories.push(repository)
  progressById.set(repository.id, {
    label: `正在克隆 ${params.owner}/${params.repo}…`,
    fraction: 0.04,
  })
  notifySubscribers()

  const onProgress: GithubProgress = (message, detail) => {
    setProgress(
      repository.id,
      message,
      resolveCloneOverallFraction(message, detail?.fraction),
    )
  }

  const promise = (async () => {
    try {
      return await cloneGithubRepository({
        owner: params.owner,
        repo: params.repo,
        onProgress,
      })
    } finally {
      removeGithubCloningRepository(repository.id)
    }
  })()

  return { repository, promise }
}
