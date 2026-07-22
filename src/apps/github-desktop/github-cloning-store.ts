import {
  cloneGithubRepository,
  type GithubProgress,
} from './github-working-tree.ts'
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
const progressById = new Map<number, string>()
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
  return progressById.get(id)
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

function setProgress(id: number, label: string) {
  if (!progressById.has(id) && !repositories.some((entry) => entry.id === id)) {
    return
  }
  progressById.set(id, label)
  notifySubscribers()
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
  progressById.set(repository.id, `正在克隆 ${params.owner}/${params.repo}…`)
  notifySubscribers()

  const onProgress: GithubProgress = (message) => {
    setProgress(repository.id, message)
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
