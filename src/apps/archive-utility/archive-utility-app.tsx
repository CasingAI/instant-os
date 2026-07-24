import { gunzipSync } from 'fflate'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  decodeGzipTar,
  extractGzipTarToDirectory,
  extractZipToDirectory,
} from '../../archive/archive-extract.ts'
import { materializeArchiveEntries } from '../../archive/archive-materialize.ts'
import { unzipBytes } from '../../archive/archive-unzip.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { filesReadBlob, filesStat } from '../files/files-api.ts'
import { assertAdditionalBytesAvailable, FilesStorageFullError } from '../files/files-storage.ts'
import {
  ARCHIVE_UTILITY_OPEN_EXTENSIONS,
  parentAbsolutePath,
  resolveArchiveUtilityFormat,
  stripArchiveExtension,
} from './archive-utility-format.ts'
import {
  allocateUniqueFileName,
  remapEntriesAwayFromExisting,
} from './archive-utility-conflict.ts'
import './archive-utility.css'

const APP_ID = 'archive-utility' as const
const THEME = '#6b7280'
const PROGRESS_ELAPSED_MS = 1000
const PROGRESS_ETA_TOTAL_MS = 5000
const PANEL_WIDTH = 420
const PANEL_HEIGHT = 120

registerFileOpenHandler({
  appId: APP_ID,
  extensions: [...ARCHIVE_UTILITY_OPEN_EXTENSIONS],
  rank: 8,
})

type ArchiveUtilityAppProps = {
  windowId?: string
}

type ProgressState = {
  done: number
  total: number
  bytesWritten: number
  currentPath?: string
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) {
    if (error.name === 'AbortError' || error.message === 'aborted') {
      return '已取消解压'
    }
    return error.message
  }
  return '解压失败'
}

function fileBaseName(absolutePath: string): string {
  const parts = absolutePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? absolutePath
}

function shouldShowProgress(elapsedMs: number, progress: ProgressState | undefined): boolean {
  if (elapsedMs < PROGRESS_ELAPSED_MS) return false
  if (!progress || progress.total <= 0 || progress.done <= 0) {
    return elapsedMs >= PROGRESS_ETA_TOTAL_MS
  }
  const estimatedTotalMs = elapsedMs / (progress.done / progress.total)
  return estimatedTotalMs > PROGRESS_ETA_TOTAL_MS
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** ZIP 本地头 / 空归档中央目录 / 分卷等均以 PK 开头 */
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function looksLikeGzip(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'aborted')
  )
}

export function ArchiveUtilityApp({ windowId }: ArchiveUtilityAppProps) {
  const {
    windows,
    activeWindowId,
    setWindowTitle,
    closeWindow,
    closeWindowsForApp,
    revealWindowlessPanel,
    bypassWindowCloseGuard,
    registerWindowCloseGuard,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const documentId = appWindow?.documentId
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  const [progress, setProgress] = useState<ProgressState | undefined>(undefined)
  const [showProgressUi, setShowProgressUi] = useState(false)
  const [clockMs, setClockMs] = useState(0)

  const abortRef = useRef<AbortController | undefined>(undefined)
  const userCancelRef = useRef(false)
  const allowCloseRef = useRef(false)
  const runIdRef = useRef(0)
  const startedPathRef = useRef<string | undefined>(undefined)
  const progressShownRef = useRef(false)
  const startAtRef = useRef(0)
  const mountedRef = useRef(true)
  const latestProgressRef = useRef<ProgressState | undefined>(undefined)

  const windowIdRef = useRef(windowId)
  const closeWindowRef = useRef(closeWindow)
  const bypassCloseRef = useRef(bypassWindowCloseGuard)
  const revealPanelRef = useRef(revealWindowlessPanel)
  const setTitleRef = useRef(setWindowTitle)
  const modalRef = useRef(modal)
  windowIdRef.current = windowId
  closeWindowRef.current = closeWindow
  bypassCloseRef.current = bypassWindowCloseGuard
  revealPanelRef.current = revealWindowlessPanel
  setTitleRef.current = setWindowTitle
  modalRef.current = modal

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      startedPathRef.current = undefined
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!windowId) return
    allowCloseRef.current = false
    registerWindowCloseGuard(windowId, () => {
      // 对话框关闭键：终止解压并放行关闭
      userCancelRef.current = true
      allowCloseRef.current = true
      abortRef.current?.abort()
      return true
    })
    return () => registerWindowCloseGuard(windowId, undefined)
  }, [registerWindowCloseGuard, windowId])

  const finishClose = useCallback(() => {
    const id = windowIdRef.current
    if (!id) return
    allowCloseRef.current = true
    bypassCloseRef.current(id)
    closeWindowRef.current(id)
  }, [])

  const showErrorAndClose = useCallback(
    async (message: string) => {
      setShowProgressUi(false)
      const id = windowIdRef.current
      // 错误对话框需要可见宿主：若进度窗尚未展开，先展开再 alert
      if (id && !progressShownRef.current) {
        revealPanelRef.current(id, {
          title: '压缩包实用工具',
          width: PANEL_WIDTH,
          height: PANEL_HEIGHT,
          chromeKind: 'dialog',
        })
      }
      await modalRef.current.alert({
        title: '无法解压',
        message,
        confirmLabel: '好',
        themeColor: THEME,
      })
      finishClose()
    },
    [finishClose],
  )

  const revealProgressPanel = useCallback((archiveName: string) => {
    const id = windowIdRef.current
    if (!id || progressShownRef.current) return
    progressShownRef.current = true
    setShowProgressUi(true)
    const title = `正在解压 ${archiveName}`
    setTitleRef.current(id, title)
    revealPanelRef.current(id, {
      title,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      chromeKind: 'dialog',
    })
  }, [])

  useEffect(() => {
    if (!documentId) {
      return
    }
    if (startedPathRef.current === documentId) {
      return
    }
    startedPathRef.current = documentId

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    userCancelRef.current = false
    allowCloseRef.current = false
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    progressShownRef.current = false
    startAtRef.current = performance.now()
    latestProgressRef.current = undefined
    setProgress(undefined)
    setShowProgressUi(false)
    setClockMs(0)

    const archiveName = fileBaseName(documentId)

    const tickProgressUi = () => {
      if (!mountedRef.current || runIdRef.current !== runId) return
      const elapsed = performance.now() - startAtRef.current
      setClockMs(elapsed)
      if (!progressShownRef.current && shouldShowProgress(elapsed, latestProgressRef.current)) {
        revealProgressPanel(archiveName)
      }
    }

    const progressTimer = window.setInterval(() => {
      tickProgressUi()
    }, 200)

    void (async () => {
      try {
        const archivePath = documentId
        const format = resolveArchiveUtilityFormat(fileBaseName(archivePath))
        if (!format) {
          throw new Error('不支持的压缩包格式')
        }

        const entry = await filesStat(archivePath)
        if (!entry || entry.kind !== 'file') {
          throw new Error('找不到压缩包')
        }

        const destRoot = parentAbsolutePath(archivePath)
        const parent = await filesStat(destRoot)
        if (!parent || parent.kind !== 'folder') {
          throw new Error('无法写入压缩包所在目录')
        }
        if (!parent.writable) {
          throw new Error('压缩包所在目录不可写')
        }

        const blob = await filesReadBlob(archivePath)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        abort.signal.throwIfAborted()

        if (bytes.byteLength === 0) {
          throw new Error('文件是空的，不是有效的压缩包')
        }

        const onProgress = (p: {
          done: number
          total: number
          bytesWritten: number
          currentPath?: string
        }) => {
          if (!mountedRef.current || runIdRef.current !== runId) return
          const next: ProgressState = {
            done: p.done,
            total: p.total,
            bytesWritten: p.bytesWritten,
            currentPath: p.currentPath,
          }
          latestProgressRef.current = next
          setProgress(next)
          tickProgressUi()
        }

        if (format === 'zip') {
          if (!looksLikeZip(bytes)) {
            throw new Error(
              '这不是有效的 ZIP 文件（文件头不匹配，可能已损坏或未按二进制保存）',
            )
          }
          let entries: Map<string, Uint8Array>
          try {
            entries = unzipBytes(bytes, { stripRoot: false })
          } catch {
            throw new Error('无法解析 ZIP（文件可能已损坏）')
          }
          if (entries.size === 0) {
            if (bytes.byteLength > 64) {
              throw new Error(
                '无法从 ZIP 中读出文件（可能已损坏或未按二进制保存）',
              )
            }
          } else {
            entries = await remapEntriesAwayFromExisting(destRoot, entries)
            await extractZipToDirectory({
              destRoot,
              zip: bytes,
              entries,
              stripRoot: false,
              signal: abort.signal,
              onProgress,
            })
          }
        } else if (format === 'gzip-tar') {
          if (!looksLikeGzip(bytes)) {
            throw new Error(
              '这不是有效的 gzip 压缩包（文件头不匹配，可能已损坏或未按二进制保存）',
            )
          }
          try {
            let entries = decodeGzipTar(bytes)
            entries = await remapEntriesAwayFromExisting(destRoot, entries)
            await extractGzipTarToDirectory({
              destRoot,
              tarball: bytes,
              entries,
              signal: abort.signal,
              onProgress,
            })
          } catch (error) {
            if (isAbortError(error)) throw error
            throw new Error('无法解析该 tar.gz 压缩包（文件可能已损坏）')
          }
        } else if (format === 'tar') {
          try {
            let entries = decodeGzipTar(bytes)
            entries = await remapEntriesAwayFromExisting(destRoot, entries)
            await extractGzipTarToDirectory({
              destRoot,
              tarball: bytes,
              entries,
              signal: abort.signal,
              onProgress,
            })
          } catch (error) {
            if (isAbortError(error)) throw error
            throw new Error('无法解析该 tar 归档（文件可能已损坏）')
          }
        } else {
          if (!looksLikeGzip(bytes)) {
            throw new Error(
              '这不是有效的 gzip 文件（文件头不匹配，可能已损坏或未按二进制保存）',
            )
          }
          let inflated: Uint8Array
          try {
            inflated = gunzipSync(bytes)
          } catch {
            throw new Error('无法解压该 gzip 文件（文件可能已损坏）')
          }
          const desiredName = stripArchiveExtension(fileBaseName(archivePath)) || 'archive'
          const outName = await allocateUniqueFileName(destRoot, desiredName)
          await assertAdditionalBytesAvailable(inflated.byteLength + 64)
          await materializeArchiveEntries({
            destRoot,
            entries: [{ relativePath: outName, bytes: inflated }],
            signal: abort.signal,
            onProgress,
          })
        }

        if (!mountedRef.current || runIdRef.current !== runId) return
        finishClose()
      } catch (error) {
        if (!mountedRef.current || runIdRef.current !== runId) return
        setShowProgressUi(false)
        const aborted = abort.signal.aborted || isAbortError(error)
        if (aborted) {
          if (userCancelRef.current) {
            finishClose()
          } else if (mountedRef.current) {
            startedPathRef.current = undefined
            void showErrorAndClose('解压被中断，请重试')
          }
          return
        }
        startedPathRef.current = undefined
        void showErrorAndClose(formatError(error))
      } finally {
        window.clearInterval(progressTimer)
      }
    })()
  }, [documentId, finishClose, revealProgressPanel, showErrorAndClose])

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '压缩包实用工具',
        items: [
          ...aboutAppMenuPrefix('关于压缩包实用工具', () => showBuiltinAbout(APP_ID)),
          { type: 'separator' },
          {
            type: 'action',
            label: '退出压缩包实用工具',
            shortcut: '⌘Q',
            onClick: () => {
              userCancelRef.current = true
              allowCloseRef.current = true
              if (windowId) bypassWindowCloseGuard(windowId)
              abortRef.current?.abort()
              closeWindowsForApp(APP_ID)
            },
          },
        ],
      },
    ]
  }, [bypassWindowCloseGuard, closeWindowsForApp, showBuiltinAbout, windowId])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : undefined

  const remainingMs = (() => {
    if (!progress || progress.total <= 0 || progress.done <= 0 || clockMs <= 0) {
      return undefined
    }
    const rate = progress.done / clockMs
    if (rate <= 0) return undefined
    return Math.max(0, (progress.total - progress.done) / rate)
  })()

  if (!showProgressUi) {
    return <div class="archive-utility-app archive-utility-app--hidden" aria-hidden="true" />
  }

  const fillPercent = percent ?? 8

  return (
    <div class="archive-utility-app">
      <div class="archive-utility-app__track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div
          class="archive-utility-app__fill"
          style={{ width: `${fillPercent}%` }}
        >
          <div class="archive-utility-app__stripe" aria-hidden="true" />
        </div>
      </div>
      <dl class="archive-utility-app__meta">
        <div>
          <dt>已用时间</dt>
          <dd>{formatDuration(clockMs)}</dd>
        </div>
        <div>
          <dt>剩余时间</dt>
          <dd>{remainingMs === undefined ? '计算中…' : formatDuration(remainingMs)}</dd>
        </div>
        <div>
          <dt>进度</dt>
          <dd>
            {progress && progress.total > 0
              ? `${progress.done}/${progress.total}${percent !== undefined ? `（${percent}%）` : ''}`
              : '准备中…'}
          </dd>
        </div>
        <div>
          <dt>已写入</dt>
          <dd>{formatBytes(progress?.bytesWritten ?? 0)}</dd>
        </div>
      </dl>
    </div>
  )
}
