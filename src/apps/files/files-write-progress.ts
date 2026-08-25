/**
 * 全局流写入进度登记表。
 *
 * openStreamWrite 打开后登记（含 expectedSize 总量），每 chunk 累加 written，
 * close/abort 后移除。列表行的「写入中」小圆圈从这里取数，不依赖
 * FILES_VFS_CHANGED_EVENT（分片写不发事件，目录缓存在 close 前也是陈旧的）。
 *
 * 通知节流：登记/移除立即通知（行要马上出现/消失圆圈）；written 更新走
 * 尾随定时器（~100ms），避免 1MB 分片高频刷新拖累列表渲染。
 */

export type FilesWriteProgressEntry = {
  nodeId: string
  written: number
  /** 预期总量（expectedSize）；缺省时行内显示不定态旋转 */
  total: number | undefined
}

type FilesWriteProgressListener = () => void

const NOTIFY_THROTTLE_MS = 100

const entries = new Map<string, FilesWriteProgressEntry>()
const listeners = new Set<FilesWriteProgressListener>()

let notifyTimer: ReturnType<typeof setTimeout> | undefined
let notifyDirty = false

function notifyNow(): void {
  if (notifyTimer !== undefined) {
    clearTimeout(notifyTimer)
    notifyTimer = undefined
  }
  notifyDirty = false
  for (const listener of listeners) listener()
}

export function subscribeFilesWriteProgress(
  listener: FilesWriteProgressListener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 返回新 Map：身份每次不同，订阅回调里直接喂 useState 即可触发渲染。 */
export function getFilesWriteProgressSnapshot(): ReadonlyMap<string, FilesWriteProgressEntry> {
  return new Map(entries)
}

export function registerFilesWriteProgress(nodeId: string, total: number | undefined): void {
  entries.set(nodeId, { nodeId, written: 0, total })
  notifyNow()
}

export function updateFilesWriteProgress(nodeId: string, written: number): void {
  const entry = entries.get(nodeId)
  if (!entry) return
  entry.written = written
  notifyDirty = true
  if (notifyTimer === undefined) {
    notifyTimer = setTimeout(() => {
      notifyTimer = undefined
      if (!notifyDirty) return
      notifyDirty = false
      for (const listener of listeners) listener()
    }, NOTIFY_THROTTLE_MS)
  }
}

export function removeFilesWriteProgress(nodeId: string): void {
  if (!entries.delete(nodeId)) return
  notifyNow()
}

export function resetFilesWriteProgressForTests(): void {
  entries.clear()
  listeners.clear()
  if (notifyTimer !== undefined) {
    clearTimeout(notifyTimer)
    notifyTimer = undefined
  }
  notifyDirty = false
}
