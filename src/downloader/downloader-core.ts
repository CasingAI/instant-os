import { proxiedFetch } from '../os/proxy-server-api.ts'
import {
  filesCreateBinary,
  filesMkdir,
  filesReadBlobRange,
  filesReadText,
  filesRemove,
  filesStat,
  filesWriteBinary,
} from '../apps/files/files-api.ts'
import { osNowMs } from '../os/os-clock.ts'
import type {
  DownloadEngineOptions,
  DownloadManifest,
  DownloadProgress,
  DownloadTask,
} from './downloader-types.ts'
import { runDownloadTask, type DownloaderEngineDeps } from './downloader-engine.ts'
import { parseMetalink } from './metalink-parser.ts'
import { DOWNLOADER_TASK_INDEX_PATH, type DownloadTaskIndex } from './download-state.ts'

const DEFAULT_TARGET_DIRECTORY = '/user/Downloads'
const DEFAULT_CONCURRENCY = 3

export type AddDownloadParams = {
  source: string | File
  targetDirectory?: string
  concurrency?: number
}

export type DownloadCoreOptions = {
  /** 注入依赖，主要用于测试 */
  deps?: DownloaderEngineDeps & {
    mkdir?: typeof filesMkdir
    readText?: typeof filesReadText
    writeBinary?: typeof filesWriteBinary
    removeFile?: typeof filesRemove
    readBlobRange?: typeof filesReadBlobRange
    stat?: typeof filesStat
    nowMs?: () => number
    fetchHead?: (url: string) => Promise<Response>
  }
}

const tasks = new Map<string, DownloadTask>()
const taskConcurrency = new Map<string, number>()
const controllers = new Map<string, AbortController>()
const progressListeners = new Set<(taskId: string, progress: DownloadProgress) => void>()

let taskIndexLoaded = false
let taskIndexCache: DownloadTaskIndex | undefined

/** 测试用：清空内存中的任务与控制器状态。 */
export function resetDownloadTasksForTests(): void {
  tasks.clear()
  taskConcurrency.clear()
  for (const controller of controllers.values()) {
    controller.abort()
  }
  controllers.clear()
  progressListeners.clear()
  taskIndexLoaded = false
  taskIndexCache = undefined
}

export async function addDownload(
  params: AddDownloadParams,
  options: DownloadCoreOptions = {},
): Promise<DownloadTask> {
  const deps = options.deps ?? {}
  const mkdir = deps.mkdir ?? filesMkdir
  const readText = deps.readText ?? filesReadText
  const writeBinary = deps.writeBinary ?? filesWriteBinary
  const nowMs = deps.nowMs ?? osNowMs
  const stat = deps.stat ?? filesStat

  const manifest = await resolveManifest(params.source, { ...deps, readText })
  const targetDir = params.targetDirectory ?? DEFAULT_TARGET_DIRECTORY
  const baseName = manifest.kind === 'metalink' ? manifest.name : inferFilename(manifest.url)
  const targetPath = await allocateTargetPath(targetDir, baseName, stat, mkdir)

  const task: DownloadTask = {
    id: `task:${crypto.randomUUID()}`,
    targetPath,
    state: 'pending',
    manifest,
    createdAt: nowMs(),
    updatedAt: nowMs(),
  }

  const concurrency = Math.max(1, params.concurrency ?? DEFAULT_CONCURRENCY)
  taskConcurrency.set(task.id, concurrency)
  tasks.set(task.id, task)
  await saveTaskIndex(writeBinary, nowMs)

  startTask(task, { concurrency, deps: options.deps })
  return task
}

export async function pauseDownload(
  taskId: string,
  options: DownloadCoreOptions = {},
): Promise<void> {
  const task = tasks.get(taskId)
  if (!task) {
    throw new Error('任务不存在')
  }
  if (task.state !== 'running') return
  const controller = controllers.get(taskId)
  controller?.abort()
  task.state = 'paused'
  task.updatedAt = (options.deps?.nowMs ?? osNowMs)()
  await saveTaskIndex(options.deps?.writeBinary ?? filesWriteBinary, options.deps?.nowMs ?? osNowMs)
}

export async function resumeDownload(
  taskId: string,
  options: DownloadCoreOptions = {},
): Promise<void> {
  const task = tasks.get(taskId)
  if (!task) {
    throw new Error('任务不存在')
  }
  if (task.state !== 'paused' && task.state !== 'failed') return
  task.state = 'pending'
  task.updatedAt = (options.deps?.nowMs ?? osNowMs)()
  const concurrency = taskConcurrency.get(taskId) ?? DEFAULT_CONCURRENCY
  startTask(task, { concurrency, deps: options.deps })
  await saveTaskIndex(options.deps?.writeBinary ?? filesWriteBinary, options.deps?.nowMs ?? osNowMs)
}

export async function cancelDownload(
  taskId: string,
  options: DownloadCoreOptions = {},
): Promise<void> {
  const task = tasks.get(taskId)
  if (!task) {
    throw new Error('任务不存在')
  }
  const controller = controllers.get(taskId)
  controller?.abort()
  controllers.delete(taskId)
  tasks.delete(taskId)
  taskConcurrency.delete(taskId)
  const removeFile = options.deps?.removeFile ?? filesRemove
  try {
    await removeFile(task.targetPath)
  } catch {
    // ignore
  }
  await saveTaskIndex(options.deps?.writeBinary ?? filesWriteBinary, options.deps?.nowMs ?? osNowMs)
}

export function listDownloads(): DownloadTask[] {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export function subscribeDownloadProgress(
  listener: (taskId: string, progress: DownloadProgress) => void,
): () => void {
  progressListeners.add(listener)
  return () => {
    progressListeners.delete(listener)
  }
}

async function resolveManifest(
  source: string | File,
  deps: {
    readText: typeof filesReadText
    fetchHead?: (url: string) => Promise<Response>
  },
): Promise<DownloadManifest> {
  if (typeof source === 'string') {
    const url = source.trim()
    let totalSize: number | undefined
    try {
      const response = await (deps.fetchHead ?? defaultFetchHead)(url)
      if (response.ok) {
        const length = response.headers.get('content-length')
        if (length) {
          const parsed = Number(length)
          if (Number.isFinite(parsed) && parsed >= 0) {
            totalSize = parsed
          }
        }
      }
    } catch {
      // ignore
    }
    return { kind: 'single', url, totalSize }
  }

  const text = await source.text()
  return parseMetalink(text, { requireUrls: true })
}

async function defaultFetchHead(url: string): Promise<Response> {
  return proxiedFetch(url, { method: 'HEAD' })
}

function inferFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const name = pathname.split('/').pop() ?? 'download'
    return name || 'download'
  } catch {
    return 'download'
  }
}

async function allocateTargetPath(
  targetDir: string,
  baseName: string,
  stat: typeof filesStat,
  mkdir: typeof filesMkdir,
): Promise<string> {
  await mkdir(targetDir).catch(() => undefined)
  const basePath = `${targetDir}/${baseName}`
  let candidate = basePath
  let index = 1
  while ((await stat(candidate)) !== undefined) {
    const dot = baseName.lastIndexOf('.')
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName
    const ext = dot > 0 ? baseName.slice(dot) : ''
    candidate = `${targetDir}/${stem} (${index})${ext}`
    index += 1
  }
  return candidate
}

function startTask(
  task: DownloadTask,
  options: { concurrency: number; deps?: DownloaderEngineDeps & { onProgress?: DownloadEngineOptions['onProgress'] } },
): void {
  if (task.state === 'running') return
  const controller = new AbortController()
  controllers.set(task.id, controller)
  task.state = 'running'

  const engineOptions: DownloadEngineOptions = {
    concurrency: options.concurrency,
    signal: controller.signal,
    onProgress: (progress) => {
      task.updatedAt = (options.deps?.nowMs ?? osNowMs)()
      for (const listener of progressListeners) {
        listener(task.id, progress)
      }
      options.deps?.onProgress?.(progress)
    },
  }

  runDownloadTask(task, engineOptions, options.deps)
    .then(async () => {
      task.state = 'completed'
      task.error = undefined
      controllers.delete(task.id)
      await saveTaskIndex(
        options.deps?.writeBinary ?? filesWriteBinary,
        options.deps?.nowMs ?? osNowMs,
      )
    })
    .catch(async (error: unknown) => {
      if (controller.signal.aborted) {
        if (task.state === 'running') {
          task.state = 'paused'
        }
      } else {
        task.state = 'failed'
        task.error = error instanceof Error ? error.message : String(error)
      }
      controllers.delete(task.id)
      await saveTaskIndex(
        options.deps?.writeBinary ?? filesWriteBinary,
        options.deps?.nowMs ?? osNowMs,
      )
    })
}

async function saveTaskIndex(
  writeBinary: typeof filesWriteBinary,
  nowMs: () => number,
): Promise<void> {
  const index: DownloadTaskIndex = {
    version: 1,
    tasks: [...tasks.values()],
  }
  taskIndexCache = index
  const json = JSON.stringify(index)
  await writeBinary(DOWNLOADER_TASK_INDEX_PATH, new TextEncoder().encode(json).buffer)
}

/** 启动时从持久化索引恢复任务列表。 */
export async function loadDownloadTasks(options: DownloadCoreOptions = {}): Promise<void> {
  if (taskIndexLoaded) return
  taskIndexLoaded = true
  const readText = options.deps?.readText ?? filesReadText
  try {
    const json = await readText(DOWNLOADER_TASK_INDEX_PATH)
    const index = JSON.parse(json) as DownloadTaskIndex
    if (index.version === 1 && Array.isArray(index.tasks)) {
      for (const task of index.tasks) {
        if (task.state === 'running') {
          task.state = 'paused'
        }
        tasks.set(task.id, task)
      }
      taskIndexCache = index
    }
  } catch {
    // ignore
  }
}
