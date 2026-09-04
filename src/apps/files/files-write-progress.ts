/**
 * 全局流写入进度登记表。
 *
 * 登记表只承载百分比：登记方（解压落盘、外部导入、流写、文件夹拷贝）手里
 * 本来就同时有 done 和 total，由它们算好 0~1 的 fraction 喂进来；圆饼只认
 * fraction——undefined 表示总量未知，画旋转弧。openStreamWrite 打开后登记，
 * 每 chunk 更新，close/abort 后移除。列表行的「写入中」小圆圈从这里取数，
 * 不依赖 FILES_VFS_CHANGED_EVENT（分片写不发事件，目录缓存在 close 前也是陈旧的）。
 *
 * 通知节流：登记/移除立即通知（行要马上出现/消失圆圈）；fraction 更新走
 * 尾随定时器（~100ms），避免 1MB 分片高频刷新拖累列表渲染。
 */

export type FilesWriteProgressEntry = {
  nodeId: string
  /** 0~1；缺省表示进度未知（行内画旋转弧） */
  fraction: number | undefined
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

export function registerFilesWriteProgress(nodeId: string, fraction: number | undefined): void {
  entries.set(nodeId, { nodeId, fraction })
  notifyNow()
}

export function updateFilesWriteProgress(nodeId: string, fraction: number): void {
  const entry = entries.get(nodeId)
  if (!entry) return
  entry.fraction = Math.min(1, Math.max(0, fraction))
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
