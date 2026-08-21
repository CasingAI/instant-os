import { joinFilesAbsolutePath } from '../files/files-path.ts'
import {
  filesOpenStreamWrite,
  filesRemove,
} from '../files/files-api.ts'
import { assertAdditionalBytesAvailable, FilesStorageFullError } from '../files/files-storage.ts'
import { ensureUserSpecialFolders, userSpecialFolderPath } from '../files/files-user-special.ts'
import { getDefaultFileOpenApp } from '../../os/file-open-registry.ts'
import {
  dismissOsNotification,
  postOsNotification,
  type OsNotificationHandlers,
} from '../../os/os-notifications.ts'
import { osOpenApp } from '../../os/os-open-app-bridge.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { proxiedFetch } from '../../os/proxy-server-api.ts'
import type { ChromoCookie } from '../../page-host/page-bridge.ts'
import { dataUrlToBytes } from './chromo-save-page.ts'
import { readBlobUrlChunksViaEval } from './chromo-download-blob.ts'
import {
  mimeFromContentType,
  resolveDownloadFileName,
} from './chromo-download-filename.ts'
import { buildChromoDownloadProxyHeaders, buildCookieHeaderForUrl } from './chromo-download-headers.ts'
import {
  pipeChunksToStreamWriter,
  readResponseBodyChunks,
} from './chromo-download-stream.ts'
import {
  createChromoDownloadId,
  formatDownloadBytes,
  getChromoDownload,
  listChromoDownloads,
  markInterruptedChromoDownloads,
  newChromoDownloadRecord,
  patchChromoDownload,
  type ChromoDownloadReason,
  type ChromoDownloadRecord,
  upsertChromoDownload,
} from './chromo-downloads.ts'

const DOWNLOADS_DIR = userSpecialFolderPath('Downloads')
const DEDUP_MS = 500
const LOCATION_SUPPRESS_MS = 2000
const NOTIFY_PROGRESS_MS = 200

type ViewerCookieApi = {
  listCookies: () => Promise<{ cookies: ChromoCookie[] }>
  evalInPage: (code: string) => Promise<unknown>
  isReady: () => boolean
}

export type ChromoDownloadRequest = {
  url: string
  filename?: string
  mime?: string
  referrer?: string
  reason?: ChromoDownloadReason
  cookies?: ChromoCookie[]
  /** 已拼好的 Cookie 头（重试时用，避免再解析罐） */
  cookieHeader?: string
  listCookies?: () => Promise<{ cookies: ChromoCookie[] }>
  evalInPage?: (code: string) => Promise<unknown>
  /** 保存链接 / 重试 / 网络面板：允许同一 URL 再下一份 */
  force?: boolean
}

type ActiveJob = {
  controller: AbortController
  request: ChromoDownloadRequest
}

const jobs = new Map<string, ActiveJob>()
const recentStarts: Array<{ url: string; at: number }> = []
let recoveryStarted = false

function notificationId(id: string): string {
  return `chromo-dl:${id}`
}

function parseContentLength(response: Response): number | undefined {
  const raw = response.headers.get('content-length')
  if (!raw) {
    return undefined
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function rememberStart(url: string): void {
  const now = Date.now()
  recentStarts.push({ url, at: now })
  while (recentStarts.length > 40) {
    recentStarts.shift()
  }
}

export function shouldSuppressDuplicateDownload(url: string, withinMs = DEDUP_MS): boolean {
  const now = Date.now()
  return recentStarts.some((item) => item.url === url && now - item.at < withinMs)
}

export function isRecentChromoDownloadUrl(url: string, withinMs = LOCATION_SUPPRESS_MS): boolean {
  const now = Date.now()
  if (recentStarts.some((item) => item.url === url && now - item.at < withinMs)) {
    return true
  }
  return listChromoDownloads().some(
    (item) => item.url === url && now - item.startedAt < withinMs,
  )
}

function progressPercent(record: ChromoDownloadRecord): number {
  if (!record.bytesTotal || record.bytesTotal <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round((record.bytesReceived / record.bytesTotal) * 100)))
}

function progressStat(record: ChromoDownloadRecord): string {
  const received = formatDownloadBytes(record.bytesReceived)
  if (record.bytesTotal != null) {
    return `${received} / ${formatDownloadBytes(record.bytesTotal)}`
  }
  return received
}

function openDownloadedPath(record: ChromoDownloadRecord): void {
  if (!record.path) {
    return
  }
  const appId = getDefaultFileOpenApp(record.filename)
  try {
    osOpenApp(appId ?? 'files', { documentId: record.path })
  } catch {
    // OS 未就绪
  }
}

function showDownloadedPath(record: ChromoDownloadRecord): void {
  if (!record.path) {
    return
  }
  try {
    osOpenApp('files', { documentId: record.path })
  } catch {
    // OS 未就绪
  }
}

function notificationHandlers(id: string): OsNotificationHandlers {
  return {
    onAction: {
      cancel: () => {
        cancelChromoDownload(id)
      },
      open: () => {
        const record = getChromoDownload(id)
        if (record) {
          openDownloadedPath(record)
        }
      },
      show: () => {
        const record = getChromoDownload(id)
        if (record) {
          showDownloadedPath(record)
        }
      },
      retry: () => {
        retryChromoDownload(id)
      },
      dismiss: () => {
        dismissOsNotification(notificationId(id))
      },
    },
  }
}

function postDownloadNotification(record: ChromoDownloadRecord): void {
  const id = notificationId(record.id)
  if (record.state === 'in-progress') {
    postOsNotification(
      {
        id,
        title: record.filename,
        subtitle: '正在下载',
        phase: 'running',
        icon: { kind: 'app', appId: 'chromo' },
        progress: {
          percent: progressPercent(record),
          statLabel: '已下载',
          statValue: progressStat(record),
        },
        banner: 'progress',
        actions: [{ id: 'cancel', label: '取消' }],
      },
      notificationHandlers(record.id),
    )
    return
  }
  if (record.state === 'completed') {
    postOsNotification(
      {
        id,
        title: record.filename,
        subtitle: '下载完成',
        phase: 'success',
        icon: { kind: 'app', appId: 'chromo' },
        banner: 'once',
        actions: [
          { id: 'open', label: '打开', tone: 'primary' },
          { id: 'show', label: '显示' },
        ],
      },
      notificationHandlers(record.id),
    )
    return
  }
  if (record.state === 'canceled') {
    dismissOsNotification(id)
    return
  }
  postOsNotification(
    {
      id,
      title: record.filename,
      subtitle: '下载失败',
      phase: 'failure',
      icon: { kind: 'app', appId: 'chromo' },
      body: record.error,
      banner: 'once',
      actions: [
        { id: 'retry', label: '重试', tone: 'primary' },
        { id: 'dismiss', label: '忽略' },
      ],
    },
    notificationHandlers(record.id),
  )
}

function failRecord(id: string, error: unknown, extra?: Partial<ChromoDownloadRecord>): ChromoDownloadRecord | undefined {
  const message =
    error instanceof FilesStorageFullError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error)
  const next = patchChromoDownload(id, {
    state: 'failed',
    endedAt: osNowMs(),
    error: message,
    path: undefined,
    ...extra,
  })
  if (next) {
    postDownloadNotification(next)
  }
  return next
}

async function snapshotCookies(request: ChromoDownloadRequest): Promise<string | undefined> {
  if (request.cookieHeader?.trim()) {
    return request.cookieHeader.trim()
  }
  let cookies = request.cookies
  if (!cookies && request.listCookies) {
    try {
      cookies = (await request.listCookies()).cookies
    } catch {
      cookies = []
    }
  }
  if (!cookies || cookies.length === 0) {
    return undefined
  }
  const header = buildCookieHeaderForUrl(cookies, request.url)
  return header || undefined
}

async function writeHttpDownload(
  record: ChromoDownloadRecord,
  request: ChromoDownloadRequest,
  signal: AbortSignal,
): Promise<void> {
  const headers = buildChromoDownloadProxyHeaders({
    cookieHeader: record.cookieHeader,
    referrer: request.referrer,
  })
  const response = await proxiedFetch(record.url, { headers, signal })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const mime = mimeFromContentType(response.headers.get('content-type')) || request.mime
  const filename = resolveDownloadFileName({
    hinted: request.filename,
    disposition: response.headers.get('content-disposition'),
    url: record.url,
    mime,
  })
  const bytesTotal = parseContentLength(response)
  if (bytesTotal && bytesTotal > 0) {
    await assertAdditionalBytesAvailable(bytesTotal)
  }

  await ensureUserSpecialFolders()
  const dest = joinFilesAbsolutePath(DOWNLOADS_DIR, filename)
  const writer = await filesOpenStreamWrite(dest, { nameMode: 'unique-suffix' })
  const path = joinFilesAbsolutePath(DOWNLOADS_DIR, writer.node.name)
  patchChromoDownload(record.id, { filename: writer.node.name, mime, bytesTotal, path }, true)

  let lastNotify = 0
  const received = await pipeChunksToStreamWriter(writer, readResponseBodyChunks(response, signal), {
    signal,
    progressIntervalMs: 160,
    onProgress: (bytesReceived) => {
      const current = patchChromoDownload(record.id, { bytesReceived }, false)
      if (!current) {
        return
      }
      const now = Date.now()
      if (now - lastNotify >= NOTIFY_PROGRESS_MS) {
        lastNotify = now
        postDownloadNotification(current)
      }
    },
  })
  const completed = patchChromoDownload(
    record.id,
    {
      state: 'completed',
      bytesReceived: received,
      bytesTotal: bytesTotal ?? received,
      endedAt: osNowMs(),
      filename: writer.node.name,
      path,
      mime,
    },
    true,
  )
  if (completed) {
    postDownloadNotification(completed)
  }
}

async function writeLocalBody(
  record: ChromoDownloadRecord,
  filename: string,
  mime: string | undefined,
  source: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): Promise<void> {
  await ensureUserSpecialFolders()
  const dest = joinFilesAbsolutePath(DOWNLOADS_DIR, filename)
  const writer = await filesOpenStreamWrite(dest, { nameMode: 'unique-suffix' })
  const path = joinFilesAbsolutePath(DOWNLOADS_DIR, writer.node.name)
  patchChromoDownload(record.id, { filename: writer.node.name, mime, path }, true)

  let lastNotify = 0
  const received = await pipeChunksToStreamWriter(writer, source, {
    signal,
    progressIntervalMs: 160,
    onProgress: (bytesReceived) => {
      const current = patchChromoDownload(record.id, { bytesReceived }, false)
      if (!current) {
        return
      }
      const now = Date.now()
      if (now - lastNotify >= NOTIFY_PROGRESS_MS) {
        lastNotify = now
        postDownloadNotification(current)
      }
    },
  })
  const completed = patchChromoDownload(
    record.id,
    {
      state: 'completed',
      bytesReceived: received,
      bytesTotal: received,
      endedAt: osNowMs(),
      filename: writer.node.name,
      path,
      mime,
    },
    true,
  )
  if (completed) {
    postDownloadNotification(completed)
  }
}

async function* bytesAsChunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes
}

async function runDownload(id: string, request: ChromoDownloadRequest, signal: AbortSignal): Promise<void> {
  const cookieHeader = await snapshotCookies(request)
  patchChromoDownload(id, { cookieHeader }, true)

  const url = request.url.trim()
  if (url.startsWith('data:')) {
    const bytes = dataUrlToBytes(url)
    const filename = resolveDownloadFileName({
      hinted: request.filename,
      url,
      mime: request.mime || mimeFromContentType(url.slice(5)),
    })
    const record = getChromoDownload(id)
    if (!record) {
      return
    }
    await writeLocalBody(record, filename, request.mime, bytesAsChunks(bytes), signal)
    return
  }

  if (url.startsWith('blob:')) {
    if (!request.evalInPage) {
      throw new Error('无法读取页内 blob（标签页已关闭）')
    }
    const filename = resolveDownloadFileName({
      hinted: request.filename,
      url,
      mime: request.mime,
    })
    const record = getChromoDownload(id)
    if (!record) {
      return
    }
    await writeLocalBody(record, filename, request.mime, readBlobUrlChunksViaEval(request.evalInPage, url), signal)
    return
  }

  if (!/^https?:/i.test(url)) {
    throw new Error('仅支持 http(s)、blob: 与 data: 下载')
  }

  const record = getChromoDownload(id)
  if (!record) {
    return
  }
  await writeHttpDownload(record, request, signal)
}

export function startChromoDownload(request: ChromoDownloadRequest): string | undefined {
  const url = request.url.trim()
  if (!url || url === '#' || url.startsWith('javascript:')) {
    return undefined
  }
  if (!request.force && shouldSuppressDuplicateDownload(url)) {
    return undefined
  }
  rememberStart(url)

  const id = createChromoDownloadId()
  const filename = resolveDownloadFileName({
    hinted: request.filename,
    url,
    mime: request.mime,
  })
  const record = newChromoDownloadRecord({
    id,
    url,
    filename,
    mime: request.mime,
    referrer: request.referrer,
    reason: request.reason,
  })
  upsertChromoDownload(record, true)
  postDownloadNotification(record)

  const controller = new AbortController()
  jobs.set(id, { controller, request })
  void (async () => {
    try {
      await runDownload(id, request, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) {
        const current = patchChromoDownload(
          id,
          { state: 'canceled', endedAt: osNowMs(), error: '已取消', path: undefined },
          true,
        )
        if (current) {
          postDownloadNotification(current)
        }
        return
      }
      failRecord(id, error)
    } finally {
      jobs.delete(id)
    }
  })()
  return id
}

export function startChromoDownloadFromViewer(
  request: Omit<ChromoDownloadRequest, 'listCookies' | 'evalInPage'> & {
    viewer?: ViewerCookieApi | null
  },
): string | undefined {
  const { viewer, ...rest } = request
  const ready = Boolean(viewer?.isReady())
  return startChromoDownload({
    ...rest,
    listCookies: ready && viewer ? () => viewer.listCookies() : undefined,
    evalInPage: ready && viewer ? (code) => viewer.evalInPage(code) : undefined,
  })
}

export function cancelChromoDownload(id: string): void {
  const job = jobs.get(id)
  if (job) {
    job.controller.abort()
    return
  }
  const current = getChromoDownload(id)
  if (current?.state === 'in-progress') {
    const next = patchChromoDownload(
      id,
      { state: 'canceled', endedAt: osNowMs(), error: '已取消', path: undefined },
      true,
    )
    if (next) {
      postDownloadNotification(next)
    }
  }
}

export function retryChromoDownload(id: string): string | undefined {
  const record = getChromoDownload(id)
  if (!record) {
    return undefined
  }
  return startChromoDownload({
    url: record.url,
    filename: record.filename,
    mime: record.mime,
    referrer: record.referrer,
    reason: 'retry',
    force: true,
    cookieHeader: record.cookieHeader,
  })
}

export async function recoverInterruptedChromoDownloads(): Promise<void> {
  if (recoveryStarted) {
    return
  }
  recoveryStarted = true
  const paths = markInterruptedChromoDownloads()
  for (const path of paths) {
    await filesRemove(path).catch(() => undefined)
  }
}

export function ensureChromoDownloadRecovery(): void {
  void recoverInterruptedChromoDownloads()
}

export { listChromoDownloads, getChromoDownload, DOWNLOADS_DIR }
