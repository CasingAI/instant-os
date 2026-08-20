/**
 * VFS 路径级变更订阅：同源写入经 VFS 成功后通知。
 * 不是真实 OS inotify；不覆盖跨标签页或挂载卷旁路写入。
 */

export type FilesWatchChangeKind = 'created' | 'modified' | 'deleted' | 'renamed'

export type FilesWatchChange = {
  kind: FilesWatchChangeKind
  /** 变更后的绝对路径（deleted 为被删路径；renamed 为新路径） */
  path: string
  /** 仅 renamed：旧绝对路径 */
  previousPath?: string
}

export type FilesWatchListener = (change: FilesWatchChange) => void

export type FilesWatchOptions = {
  /**
   * 是否匹配子孙路径。默认 true：
   * - 监视目录时：自身与子孙
   * - 监视文件时：精确匹配该文件
   * false 时仅精确匹配 path / previousPath。
   */
  recursive?: boolean
}

type WatchEntry = {
  watchPath: string
  recursive: boolean
  listener: FilesWatchListener
}

const watchers = new Set<WatchEntry>()

function normalizeWatchPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed.startsWith('/')) {
    throw new Error('监视路径必须是以 / 开头的全局绝对路径')
  }
  return trimmed.replace(/\/+$/, '') || '/'
}

function pathMatchesWatch(
  candidate: string | undefined,
  watchPath: string,
  recursive: boolean,
): boolean {
  if (!candidate) return false
  if (candidate === watchPath) return true
  if (!recursive) return false
  if (watchPath === '/') return candidate.startsWith('/')
  return candidate.startsWith(`${watchPath}/`)
}

function changeMatchesWatch(change: FilesWatchChange, entry: WatchEntry): boolean {
  if (pathMatchesWatch(change.path, entry.watchPath, entry.recursive)) return true
  if (change.kind === 'renamed') {
    return pathMatchesWatch(change.previousPath, entry.watchPath, entry.recursive)
  }
  return false
}

/** 订阅某绝对路径（文件或目录）的变更；返回取消订阅函数 */
export function subscribeFilesWatch(
  watchPath: string,
  listener: FilesWatchListener,
  options?: FilesWatchOptions,
): () => void {
  const entry: WatchEntry = {
    watchPath: normalizeWatchPath(watchPath),
    recursive: options?.recursive !== false,
    listener,
  }
  watchers.add(entry)
  return () => {
    watchers.delete(entry)
  }
}

/** 由 VFS 在成功变更后调用；可一次通知多条 */
export function notifyFilesWatch(change: FilesWatchChange | readonly FilesWatchChange[]): void {
  const list: readonly FilesWatchChange[] = Array.isArray(change) ? change : [change]
  if (list.length === 0 || watchers.size === 0) return

  for (const item of list) {
    for (const entry of [...watchers]) {
      if (!changeMatchesWatch(item, entry)) continue
      try {
        entry.listener(item)
      } catch (err) {
        console.error('[files-watch] listener error', err)
      }
    }
  }
}
