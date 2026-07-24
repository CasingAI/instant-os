import { gunzipSync } from 'fflate'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import {
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
import { getFloatingOverlayRoot } from '../../ui/floating-overlay-root.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { filesReadBlob, filesStat } from '../files/files-api.ts'
import { assertAdditionalBytesAvailable, FilesStorageFullError } from '../files/files-storage.ts'
import {
  ARCHIVE_UTILITY_OPEN_EXTENSIONS,
  parentAbsolutePath,
  resolveArchiveUtilityFormat,
  stripArchiveExtension,
} from './archive-utility-format.ts'
import './archive-utility.css'

const APP_ID = 'archive-utility' as const
const THEME = '#6b7280'
const PROGRESS_ELAPSED_MS = 1000
const PROGRESS_ETA_TOTAL_MS = 5000

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
    minimizeWindow,
    restoreWindow,
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

  const abortRef = useRef<AbortController | undefined>(undefined)
  const userCancelRef = useRef(false)
  const runIdRef = useRef(0)
  const startedPathRef = useRef<string | undefined>(undefined)
  const progressShownRef = useRef(false)
  const startAtRef = useRef(0)
  const mountedRef = useRef(true)
  const latestProgressRef = useRef<ProgressState | undefined>(undefined)

  const windowIdRef = useRef(windowId)
  const closeWindowRef = useRef(closeWindow)
  const minimizeWindowRef = useRef(minimizeWindow)
  const restoreWindowRef = useRef(restoreWindow)
  const modalRef = useRef(modal)
  windowIdRef.current = windowId
  closeWindowRef.current = closeWindow
  minimizeWindowRef.current = minimizeWindow
  restoreWindowRef.current = restoreWindow
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
    setWindowTitle(windowId, '压缩包实用工具')
  }, [setWindowTitle, windowId])

  const finishClose = useCallback(() => {
    const id = windowIdRef.current
    if (id) closeWindowRef.current(id)
  }, [])

  const showErrorAndClose = useCallback(
    async (message: string) => {
      const id = windowIdRef.current
      if (id) {
        restoreWindowRef.current(id)
      }
      setShowProgressUi(false)
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

  const cancelExtract = useCallback(() => {
    userCancelRef.current = true
    abortRef.current?.abort()
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
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    progressShownRef.current = false
    startAtRef.current = performance.now()
    latestProgressRef.current = undefined
    setProgress(undefined)
    setShowProgressUi(false)

    const id = windowIdRef.current
    if (id) {
      minimizeWindowRef.current(id)
    }

    const tickProgressUi = () => {
      if (!mountedRef.current || runIdRef.current !== runId) return
      const elapsed = performance.now() - startAtRef.current
      if (!progressShownRef.current && shouldShowProgress(elapsed, latestProgressRef.current)) {
        progressShownRef.current = true
        setShowProgressUi(true)
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
          // 仅「极小的空归档」视为成功；有体积却解出 0 个文件 → 内容异常
          if (entries.size === 0) {
            if (bytes.byteLength > 64) {
              throw new Error(
                '无法从 ZIP 中读出文件（可能已损坏或未按二进制保存）',
              )
            }
          } else {
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
            await extractGzipTarToDirectory({
              destRoot,
              tarball: bytes,
              signal: abort.signal,
              onProgress,
            })
          } catch (error) {
            if (isAbortError(error)) throw error
            throw new Error('无法解析该 tar.gz 压缩包（文件可能已损坏）')
          }
        } else if (format === 'tar') {
          try {
            await extractGzipTarToDirectory({
              destRoot,
              tarball: bytes,
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
          const outName = stripArchiveExtension(fileBaseName(archivePath)) || 'archive'
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
  }, [documentId, finishClose, showErrorAndClose])

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
              abortRef.current?.abort()
              closeWindowsForApp(APP_ID)
            },
          },
        ],
      },
    ]
  }, [closeWindowsForApp, showBuiltinAbout])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : undefined

  const progressPortal = showProgressUi
    ? createPortal(
        <div class="archive-utility-progress-host">
          <div
            class="archive-utility-progress"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-utility-progress-title"
            style={{ '--archive-utility-theme': THEME } as Record<string, string>}
          >
            <h3 class="archive-utility-progress__title" id="archive-utility-progress-title">
              正在解压
            </h3>
            <p class="archive-utility-progress__detail">
              {progress && progress.total > 0
                ? `${progress.done}/${progress.total}${percent !== undefined ? `（${percent}%）` : ''}`
                : '准备中…'}
            </p>
            <div class="archive-utility-progress__track" aria-hidden="true">
              <div
                class="archive-utility-progress__fill"
                style={{
                  width: `${percent ?? 8}%`,
                }}
              />
            </div>
            <div class="archive-utility-progress__actions">
              <button
                type="button"
                class="archive-utility-progress__btn"
                onClick={cancelExtract}
              >
                停止
              </button>
            </div>
          </div>
        </div>,
        getFloatingOverlayRoot(),
      )
    : undefined

  return (
    <>
      <div class="archive-utility-app" aria-hidden="true" />
      {progressPortal}
    </>
  )
}
