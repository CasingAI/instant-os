import type { DownloadTask } from './downloader-types.ts'

export const DOWNLOADER_TASK_INDEX_PATH = '/dev/downloader/tasks.json'

export type DownloadTaskIndex = {
  tasks: DownloadTask[]
  version: 1
}

/**
 * 序列化任务索引为 JSON。
 * 注意：每个 task 的完成区间主要由目标文件头部的 .download header 自描述，
 * 此处只保存轻量任务列表与状态。
 */
export function serializeTaskIndex(index: DownloadTaskIndex): string {
  return JSON.stringify(index)
}

export function parseTaskIndex(json: string): DownloadTaskIndex {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('任务索引格式错误')
  }
  const v = parsed as { version?: unknown; tasks?: unknown }
  if (v.version !== 1) {
    throw new Error('任务索引版本不匹配')
  }
  if (!Array.isArray(v.tasks)) {
    throw new Error('任务索引缺少 tasks')
  }
  return { version: 1, tasks: v.tasks as DownloadTask[] }
}
