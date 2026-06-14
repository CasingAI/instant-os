import type { ComponentChild } from 'preact'
import { render } from 'preact'
import { toPng } from 'html-to-image'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import '../apps/generated/generated-app-icon.css'
import '../icons/app-icon-tile.css'
import type { AppId } from '../os/types.ts'
import type { FolderPreviewApp } from './desktop-folder-icon.tsx'
import {
  deleteFolderIconSnapshotsForApp,
  getAllFolderIconSnapshots,
  putFolderIconSnapshot,
} from './desktop-folder-mini-icon-storage.ts'

/** 标准尺寸完整渲染后再截图缩小，避免极小尺寸下 SVG/emoji 错位 */
export const FOLDER_MINI_ICON_CAPTURE_SIZE = 72

const snapshotCache = new Map<string, string>()
const inflightResolves = new Map<string, Promise<string | undefined>>()

let warmPromise: Promise<void> | undefined
let captureTail: Promise<void> = Promise.resolve()

function buildSnapshotKey(app: FolderPreviewApp): string {
  if (app.kind === 'builtin') {
    return `builtin:${app.appId}`
  }
  return `generated:${app.appId}:${app.emoji}:${app.themeColor}`
}

function renderCaptureIcon(app: FolderPreviewApp): ComponentChild {
  if (app.kind === 'builtin') {
    return <app.Icon size={FOLDER_MINI_ICON_CAPTURE_SIZE} />
  }

  return (
    <GeneratedAppIcon
      emoji={app.emoji}
      themeColor={app.themeColor}
      size={FOLDER_MINI_ICON_CAPTURE_SIZE}
    />
  )
}

export function getFolderMiniIconSnapshotKey(app: FolderPreviewApp): string {
  return buildSnapshotKey(app)
}

export function peekFolderMiniIconSnapshot(key: string): string | undefined {
  return snapshotCache.get(key)
}

export async function warmFolderMiniIconSnapshotCache(): Promise<void> {
  if (!warmPromise) {
    warmPromise = (async () => {
      const records = await getAllFolderIconSnapshots()
      for (const record of records) {
        snapshotCache.set(record.key, record.dataUrl)
      }
    })()
  }

  await warmPromise
}

function scheduleIdleWork(task: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(task, { timeout: 1200 })
    return
  }

  window.setTimeout(task, 32)
}

async function waitForCapturePaint(): Promise<void> {
  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function captureFolderMiniIcon(app: FolderPreviewApp): Promise<string | undefined> {
  const host = document.createElement('div')
  host.className = 'desktop-folder-mini-icon-capture-host'
  document.body.appendChild(host)

  try {
    render(
      <span
        class="desktop-folder-mini-icon-capture-target"
        style={{
          width: `${FOLDER_MINI_ICON_CAPTURE_SIZE}px`,
          height: `${FOLDER_MINI_ICON_CAPTURE_SIZE}px`,
          display: 'flex',
        }}
      >
        {renderCaptureIcon(app)}
      </span>,
      host,
    )

    await waitForCapturePaint()

    const target = host.querySelector('.desktop-folder-mini-icon-capture-target')
    if (!(target instanceof HTMLElement)) {
      return undefined
    }

    return await toPng(target, {
      width: FOLDER_MINI_ICON_CAPTURE_SIZE,
      height: FOLDER_MINI_ICON_CAPTURE_SIZE,
      pixelRatio: 1,
      cacheBust: false,
    })
  } catch {
    return undefined
  } finally {
    render(undefined, host)
    host.remove()
  }
}

function enqueueCapture(task: () => Promise<string | undefined>): Promise<string | undefined> {
  const run = async () => {
    await new Promise<void>((resolve) => {
      scheduleIdleWork(resolve)
    })
    return task()
  }

  const next = captureTail.then(run, run)
  captureTail = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export function resolveFolderMiniIconSnapshot(
  app: FolderPreviewApp,
): Promise<string | undefined> {
  const cacheKey = buildSnapshotKey(app)
  const cached = snapshotCache.get(cacheKey)
  if (cached) {
    return Promise.resolve(cached)
  }

  const inflight = inflightResolves.get(cacheKey)
  if (inflight) {
    return inflight
  }

  const promise = (async () => {
    await warmFolderMiniIconSnapshotCache()

    const warmed = snapshotCache.get(cacheKey)
    if (warmed) {
      return warmed
    }

    const dataUrl = await enqueueCapture(() => captureFolderMiniIcon(app))
    if (!dataUrl) {
      return undefined
    }

    snapshotCache.set(cacheKey, dataUrl)
    void putFolderIconSnapshot(cacheKey, dataUrl)
    return dataUrl
  })()

  inflightResolves.set(cacheKey, promise)

  void promise.finally(() => {
    if (inflightResolves.get(cacheKey) === promise) {
      inflightResolves.delete(cacheKey)
    }
  })

  return promise
}

export function invalidateFolderMiniIconSnapshot(appId: AppId): void {
  for (const key of snapshotCache.keys()) {
    if (key.includes(`:${appId}`)) {
      snapshotCache.delete(key)
    }
  }
  void deleteFolderIconSnapshotsForApp(appId)
}
