import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { Button } from '../../ui/button.tsx'
import { IosTextField } from '../../ui/ios-text-field.tsx'
import { Progress } from '../../ui/progress.tsx'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import { filesReadText } from '../files/files-api.ts'
import {
  addDownload,
  cancelDownload,
  listDownloads,
  loadDownloadTasks,
  pauseDownload,
  resumeDownload,
  subscribeDownloadProgress,
} from '../../downloader/downloader-core.ts'
import type {
  DownloadProgress,
  DownloadTask,
  DownloadTaskState,
} from '../../downloader/downloader-types.ts'
import './downloader.css'

const APP_ID = 'downloader' as const
const THEME = '#3a7bd5'
const DEFAULT_TARGET_DIRECTORY = '/user/Downloads'
const DEFAULT_CONCURRENCY = 3

type DownloaderAppProps = {
  windowId?: string
}

function fileBaseName(absolutePath: string): string {
  const parts = absolutePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? absolutePath
}

function fileParentPath(absolutePath: string): string {
  const trimmed = absolutePath.replace(/\/+$/, '')
  const lastSlash = trimmed.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return trimmed.slice(0, lastSlash)
}

function formatSpeed(bytesPerSecond: number | undefined): string {
  if (bytesPerSecond === undefined || Number.isNaN(bytesPerSecond) || bytesPerSecond <= 0) {
    return ''
  }
  return `${formatStorageSize(bytesPerSecond)}/s`
}

function stateLabel(state: DownloadTaskState): string {
  switch (state) {
    case 'pending':
      return '等待中'
    case 'running':
      return '下载中'
    case 'paused':
      return '已暂停'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
  }
}

function clampConcurrency(value: number): number {
  return Math.max(1, Math.min(16, Math.round(value)))
}

export function DownloaderApp({ windowId }: DownloaderAppProps) {
  const {
    windows,
    activeWindowId,
    setWindowTitle,
    openApp,
  } = useOs()
  const modal = useWindowModal()
  const { showSystemOpenDialog, dialog: systemOpenDialog } = useSystemOpenDialog()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const documentId = appWindow?.documentId
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [progressMap, setProgressMap] = useState<Record<string, DownloadProgress>>({})
  const [showAddDialog, setShowAddDialog] = useState(false)

  const [url, setUrl] = useState('')
  const [localFilePath, setLocalFilePath] = useState<string | undefined>(undefined)
  const [targetDirectory, setTargetDirectory] = useState(DEFAULT_TARGET_DIRECTORY)
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY)
  const [isAdding, setIsAdding] = useState(false)

  const processedDocumentIdRef = useRef<string | undefined>(undefined)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshTasks = useCallback(() => {
    if (!mountedRef.current) return
    setTasks(listDownloads())
  }, [])

  useEffect(() => {
    if (!windowId) return
    setWindowTitle(windowId, '下载器')
  }, [setWindowTitle, windowId])

  useEffect(() => {
    void loadDownloadTasks().then(refreshTasks)
    const interval = setInterval(refreshTasks, 500)
    const unsubscribe = subscribeDownloadProgress((taskId, progress) => {
      if (!mountedRef.current) return
      setProgressMap((current) => ({ ...current, [taskId]: progress }))
    })
    return () => {
      clearInterval(interval)
      unsubscribe()
    }
  }, [refreshTasks])

  const handleOpenMetalinkFile = useCallback(
    async (path: string) => {
      try {
        const text = await filesReadText(path)
        const blob = new Blob([text], { type: 'application/metalink+xml' })
        const file = new File([blob], fileBaseName(path), { type: 'application/metalink+xml' })
        await addDownload({ source: file, targetDirectory: DEFAULT_TARGET_DIRECTORY })
        refreshTasks()
      } catch (error) {
        await modal.alert({
          title: '无法打开 Metalink 文件',
          message: error instanceof Error ? error.message : '读取文件失败',
          themeColor: THEME,
        })
      }
    },
    [modal, refreshTasks],
  )

  useEffect(() => {
    if (!documentId || documentId === processedDocumentIdRef.current) return
    processedDocumentIdRef.current = documentId
    void handleOpenMetalinkFile(documentId)
  }, [documentId, handleOpenMetalinkFile])

  const handleAddDownload = useCallback(async () => {
    const trimmedUrl = url.trim()
    if (!trimmedUrl && !localFilePath) {
      await modal.alert({
        title: '无法添加任务',
        message: '请输入下载地址或选择本地 .metalink 文件',
        themeColor: THEME,
      })
      return
    }

    setIsAdding(true)
    try {
      if (localFilePath) {
        const text = await filesReadText(localFilePath)
        const blob = new Blob([text], { type: 'application/metalink+xml' })
        const file = new File([blob], fileBaseName(localFilePath), {
          type: 'application/metalink+xml',
        })
        await addDownload({
          source: file,
          targetDirectory,
          concurrency,
        })
      } else {
        await addDownload({
          source: trimmedUrl,
          targetDirectory,
          concurrency,
        })
      }
      setShowAddDialog(false)
      setUrl('')
      setLocalFilePath(undefined)
      refreshTasks()
    } catch (error) {
      await modal.alert({
        title: '添加下载失败',
        message: error instanceof Error ? error.message : '未知错误',
        themeColor: THEME,
      })
    } finally {
      setIsAdding(false)
    }
  }, [concurrency, localFilePath, modal, refreshTasks, targetDirectory, url])

  const handlePickTargetDirectory = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择保存位置',
      selectionMode: 'folder',
      initialPath: DEFAULT_TARGET_DIRECTORY,
    })
    if (path) {
      setTargetDirectory(path)
    }
  }, [showSystemOpenDialog])

  const handlePickMetalinkFile = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择 Metalink 文件',
      selectionMode: 'file',
      acceptExtensions: ['metalink'],
      initialPath: DEFAULT_TARGET_DIRECTORY,
    })
    if (path) {
      setLocalFilePath(path)
      setUrl('')
    }
  }, [showSystemOpenDialog])

  const handlePauseResume = useCallback(
    async (task: DownloadTask) => {
      try {
        if (task.state === 'running') {
          await pauseDownload(task.id)
        } else if (task.state === 'paused' || task.state === 'failed') {
          await resumeDownload(task.id)
        }
        refreshTasks()
      } catch (error) {
        await modal.alert({
          title: '操作失败',
          message: error instanceof Error ? error.message : '未知错误',
          themeColor: THEME,
        })
      }
    },
    [modal, refreshTasks],
  )

  const handleDelete = useCallback(
    async (task: DownloadTask) => {
      const ok = await modal.confirm({
        title: '删除任务？',
        message: `删除「${fileBaseName(task.targetPath)}」及其未完成文件？`,
        confirmLabel: '删除',
        confirmTone: 'danger',
        themeColor: THEME,
      })
      if (!ok) return
      try {
        await cancelDownload(task.id)
        setProgressMap((current) => {
          const next = { ...current }
          delete next[task.id]
          return next
        })
        refreshTasks()
      } catch (error) {
        await modal.alert({
          title: '删除失败',
          message: error instanceof Error ? error.message : '未知错误',
          themeColor: THEME,
        })
      }
    },
    [modal, refreshTasks],
  )

  const handleOpenFolder = useCallback(
    (task: DownloadTask) => {
      openApp('files', { documentId: fileParentPath(task.targetPath) })
    },
    [openApp],
  )

  const openAddDialog = useCallback(() => {
    setUrl('')
    setLocalFilePath(undefined)
    setTargetDirectory(DEFAULT_TARGET_DIRECTORY)
    setConcurrency(DEFAULT_CONCURRENCY)
    setShowAddDialog(true)
  }, [])

  const totalSpeed = useMemo(() => {
    let sum = 0
    for (const task of tasks) {
      if (task.state === 'running') {
        sum += progressMap[task.id]?.bytesPerSecond ?? 0
      }
    }
    return sum
  }, [progressMap, tasks])

  const runningCount = useMemo(() => tasks.filter((t) => t.state === 'running').length, [tasks])

  const menuBar = useMemo((): MenuDefinition[] => {
    const items: MenuDefinition['items'] = [
      {
        type: 'action',
        label: '新建下载…',
        shortcut: '⌘N',
        onClick: openAddDialog,
      },
      { type: 'separator' },
      {
        type: 'action',
        label: '全部开始',
        disabled: tasks.every((t) => t.state !== 'paused' && t.state !== 'failed'),
        onClick: () => {
          for (const task of tasks) {
            if (task.state === 'paused' || task.state === 'failed') {
              void resumeDownload(task.id).then(refreshTasks)
            }
          }
        },
      },
      {
        type: 'action',
        label: '全部暂停',
        disabled: runningCount === 0,
        onClick: () => {
          for (const task of tasks) {
            if (task.state === 'running') {
              void pauseDownload(task.id).then(refreshTasks)
            }
          }
        },
      },
      { type: 'separator' },
      {
        type: 'action',
        label: runningCount > 0 ? `总速度：${formatSpeed(totalSpeed)}` : '无下载活动',
        disabled: true,
        onClick: () => {},
      },
    ]
    return [{ label: '文件', items }]
  }, [openAddDialog, refreshTasks, runningCount, tasks, totalSpeed])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  function renderAddDialog() {
    if (!showAddDialog) return null
    const canSubmit = (url.trim() || localFilePath) && !isAdding
    return (
      <div class="downloader-app__overlay" role="dialog" aria-label="新建下载">
        <div class="downloader-app__dialog">
          <p class="downloader-app__dialog-title">新建下载</p>
          <div class="downloader-app__dialog-row">
            <span class="downloader-app__dialog-label">下载地址</span>
            <IosTextField
              class="downloader-app__dialog-input"
              placeholder="https://… 或 .metalink 链接"
              value={url}
              disabled={!!localFilePath || isAdding}
              onInput={(event) => {
                setUrl((event.target as HTMLInputElement).value)
                if (localFilePath) setLocalFilePath(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSubmit) {
                  event.preventDefault()
                  void handleAddDownload()
                }
              }}
            />
          </div>
          <div class="downloader-app__dialog-row">
            <span class="downloader-app__dialog-label">或</span>
            <Button
              onClick={() => void handlePickMetalinkFile()}
              disabled={isAdding}
            >
              选择本地 .metalink 文件
            </Button>
            {localFilePath ? (
              <span class="downloader-app__dialog-file">{fileBaseName(localFilePath)}</span>
            ) : undefined}
          </div>
          <div class="downloader-app__dialog-row">
            <span class="downloader-app__dialog-label">保存到</span>
            <IosTextField
              class="downloader-app__dialog-input"
              value={targetDirectory}
              disabled={isAdding}
              onInput={(event) => setTargetDirectory((event.target as HTMLInputElement).value)}
            />
            <Button
              onClick={() => void handlePickTargetDirectory()}
              disabled={isAdding}
            >
              选择…
            </Button>
          </div>
          <div class="downloader-app__dialog-row">
            <span class="downloader-app__dialog-label">并发数</span>
            <input
              type="range"
              min={1}
              max={16}
              value={concurrency}
              disabled={isAdding}
              onInput={(event) => setConcurrency(clampConcurrency(Number((event.target as HTMLInputElement).value)))}
              aria-label="并发数"
            />
            <span class="downloader-app__dialog-concurrency">{concurrency}</span>
          </div>
          <div class="downloader-app__dialog-actions">
            <Button onClick={() => setShowAddDialog(false)} disabled={isAdding}>
              取消
            </Button>
            <Button
              tone="primary"
              disabled={!canSubmit}
              onClick={() => void handleAddDownload()}
            >
              {isAdding ? '添加中…' : '添加'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  function renderToolbar() {
    return (
      <div class="downloader-app__toolbar">
        <Button tone="primary" icon="+" onClick={() => openAddDialog()} aria-label="新建下载" />
        <span class="downloader-app__toolbar-title">下载器</span>
        <span class="downloader-app__toolbar-spacer" aria-hidden="true" />
        {runningCount > 0 ? (
          <span class="downloader-app__toolbar-speed">总速度：{formatSpeed(totalSpeed)}</span>
        ) : undefined}
      </div>
    )
  }

  function renderTaskProgress(task: DownloadTask) {
    const progress = progressMap[task.id]
    const totalBytes = task.manifest.totalSize ?? progress?.totalBytes
    const downloadedBytes = progress?.downloadedBytes ?? 0
    const percent = totalBytes ? (downloadedBytes / totalBytes) * 100 : 0
    const status: 'active' | 'success' | 'error' | 'normal' =
      task.state === 'running' ? 'active' : task.state === 'completed' ? 'success' : task.state === 'failed' ? 'error' : 'normal'
    return (
      <Progress
        className="downloader-app__task-progress"
        percent={percent}
        status={status}
        size="small"
        showInfo={!!totalBytes}
      />
    )
  }

  function renderTaskRow(task: DownloadTask) {
    const progress = progressMap[task.id]
    const totalBytes = task.manifest.totalSize ?? progress?.totalBytes
    const downloadedBytes = progress?.downloadedBytes ?? 0
    const isRunning = task.state === 'running'
    const isPausable = task.state === 'running'
    const isResumable = task.state === 'paused' || task.state === 'failed'
    const canOpenFolder = task.state === 'completed'

    return (
      <div key={task.id} class="downloader-app__row" role="row">
        <span class="downloader-app__col downloader-app__col--name" title={task.targetPath}>
          {fileBaseName(task.targetPath)}
        </span>
        <span class="downloader-app__col downloader-app__col--size">
          {totalBytes !== undefined
            ? `${formatStorageSize(downloadedBytes)} / ${formatStorageSize(totalBytes)}`
            : `${formatStorageSize(downloadedBytes)}`}
        </span>
        <span class="downloader-app__col downloader-app__col--progress">
          {renderTaskProgress(task)}
        </span>
        <span class="downloader-app__col downloader-app__col--speed">
          {isRunning ? formatSpeed(progress?.bytesPerSecond) : ''}
        </span>
        <span
          class={`downloader-app__col downloader-app__col--state downloader-app__col--state-${task.state}`}
        >
          {stateLabel(task.state)}
        </span>
        <span class="downloader-app__col downloader-app__col--actions">
          {isPausable ? (
            <Button onClick={() => void handlePauseResume(task)}>
              暂停
            </Button>
          ) : isResumable ? (
            <Button onClick={() => void handlePauseResume(task)}>
              继续
            </Button>
          ) : (
            <span class="downloader-app__action-placeholder" />
          )}
          {canOpenFolder ? (
            <Button onClick={() => handleOpenFolder(task)}>
              打开文件夹
            </Button>
          ) : undefined}
          <Button
            tone="danger"
            onClick={() => void handleDelete(task)}
          >
            删除
          </Button>
        </span>
      </div>
    )
  }

  function renderEmpty() {
    return (
      <div class="downloader-app__empty">
        <p class="downloader-app__empty-title">暂无下载任务</p>
        <p class="downloader-app__empty-hint">点击右上角 + 新建下载，或双击 .metalink 文件。</p>
        <Button tone="primary" onClick={() => openAddDialog()}>
          新建下载
        </Button>
      </div>
    )
  }

  return (
    <div class="downloader-app">
      {renderToolbar()}
      <div class="downloader-app__content">
        {tasks.length === 0 ? (
          renderEmpty()
        ) : (
          <div class="downloader-app__table" role="table" aria-label="下载任务">
            <div class="downloader-app__table-head" role="row">
              <span role="columnheader" class="downloader-app__col downloader-app__col--name">名称</span>
              <span role="columnheader" class="downloader-app__col downloader-app__col--size">大小</span>
              <span role="columnheader" class="downloader-app__col downloader-app__col--progress">进度</span>
              <span role="columnheader" class="downloader-app__col downloader-app__col--speed">速度</span>
              <span role="columnheader" class="downloader-app__col downloader-app__col--state">状态</span>
              <span role="columnheader" class="downloader-app__col downloader-app__col--actions">操作</span>
            </div>
            <div class="downloader-app__table-body" role="rowgroup">
              {tasks.map(renderTaskRow)}
            </div>
          </div>
        )}
      </div>
      {renderAddDialog()}
      {systemOpenDialog}
    </div>
  )
}
