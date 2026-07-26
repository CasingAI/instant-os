import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import { useIconContextMenu } from '../../os/icon-context-menu-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { findNodeByPath, scanPath } from './space-sniffer-scan.ts'
import { SpaceSnifferTreemap } from './space-sniffer-treemap.tsx'
import {
  DEFAULT_DETAIL_LEVEL,
  MAX_DETAIL_LEVEL,
  MIN_DETAIL_LEVEL,
  type ScanNode,
  type ScanProgress,
} from './space-sniffer-types.ts'

type SpaceSnifferViewProps = {
  rootPath: string
  onNewScan: () => void
  onRequestClose?: () => void
}

export function SpaceSnifferView({ rootPath, onNewScan, onRequestClose }: SpaceSnifferViewProps) {
  const { openApp } = useOs()
  const { showIconContextMenu } = useIconContextMenu()

  const [progress, setProgress] = useState<ScanProgress | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  const [detailLevel, setDetailLevel] = useState(DEFAULT_DETAIL_LEVEL)
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined)
  const [viewPath, setViewPath] = useState(rootPath)
  const [history, setHistory] = useState<string[]>([rootPath])
  const [historyIndex, setHistoryIndex] = useState(0)

  const abortRef = useRef<AbortController | undefined>(undefined)
  const scanGenerationRef = useRef(0)

  const stopScan = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = undefined
    setScanning(false)
  }, [])

  const startScan = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const generation = scanGenerationRef.current + 1
    scanGenerationRef.current = generation

    setScanning(true)
    setProgress(undefined)
    setSelectedPath(undefined)
    setViewPath(rootPath)
    setHistory([rootPath])
    setHistoryIndex(0)

    try {
      await scanPath(rootPath, {
        signal: controller.signal,
        onProgress: (next) => {
          if (scanGenerationRef.current !== generation) return
          setProgress(next)
        },
      })
    } finally {
      if (scanGenerationRef.current === generation) {
        setScanning(false)
        abortRef.current = undefined
      }
    }
  }, [rootPath])

  useEffect(() => {
    void startScan()
    return () => {
      abortRef.current?.abort()
    }
  }, [startScan])

  const scanRoot = progress?.root

  const viewRoot = useMemo(() => {
    if (!scanRoot) return undefined
    return findNodeByPath(scanRoot, viewPath) ?? scanRoot
  }, [scanRoot, viewPath])

  const historyRef = useRef({ entries: [rootPath], index: 0 })
  historyRef.current = { entries: history, index: historyIndex }

  const navigateTo = useCallback((path: string, recordHistory: boolean) => {
    setViewPath(path)
    setSelectedPath(path)
    if (!recordHistory) return
    const { entries, index } = historyRef.current
    const trimmed = entries.slice(0, index + 1)
    if (trimmed[trimmed.length - 1] === path) {
      return
    }
    const next = [...trimmed, path]
    setHistory(next)
    setHistoryIndex(next.length - 1)
  }, [])

  const goBack = useCallback(() => {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const path = history[nextIndex]
    if (!path) return
    setHistoryIndex(nextIndex)
    setViewPath(path)
    setSelectedPath(path)
  }, [history, historyIndex])

  const goForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    const path = history[nextIndex]
    if (!path) return
    setHistoryIndex(nextIndex)
    setViewPath(path)
    setSelectedPath(path)
  }, [history, historyIndex])

  const goUp = useCallback(() => {
    if (!viewRoot || viewRoot.path === rootPath) return
    const parentPath = viewRoot.path.replace(/\/[^/]+$/, '') || rootPath
    const target = parentPath.startsWith(rootPath) ? parentPath : rootPath
    navigateTo(target, true)
  }, [navigateTo, rootPath, viewRoot])

  const goHome = useCallback(() => {
    navigateTo(rootPath, true)
  }, [navigateTo, rootPath])

  const handleActivate = useCallback(
    (node: ScanNode) => {
      if (node.kind === 'folder') {
        navigateTo(node.path, true)
      }
    },
    [navigateTo],
  )

  const handleContextMenu = useCallback(
    (event: MouseEvent, node: ScanNode) => {
      const items = [
        {
          type: 'action' as const,
          label: '在文件中显示',
          onClick: () => openApp('files', { documentId: node.path }),
        },
      ]
      if (node.kind === 'folder') {
        items.push({
          type: 'action',
          label: '进入此文件夹',
          onClick: () => navigateTo(node.path, true),
        })
      }
      showIconContextMenu(event, items)
    },
    [navigateTo, openApp, showIconContextMenu],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        onNewScan()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        onRequestClose?.()
        return
      }

      if (event.key === 'Backspace' && !event.shiftKey) {
        event.preventDefault()
        goBack()
        return
      }

      if (event.key === 'Backspace' && event.shiftKey) {
        event.preventDefault()
        goForward()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
        event.preventDefault()
        goUp()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Home') {
        event.preventDefault()
        goHome()
        return
      }

      if ((event.metaKey || event.ctrlKey) && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        setDetailLevel((value) => Math.min(MAX_DETAIL_LEVEL, value + 1))
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === '-') {
        event.preventDefault()
        setDetailLevel((value) => Math.max(MIN_DETAIL_LEVEL, value - 1))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goBack, goForward, goHome, goUp, onNewScan, onRequestClose])

  const viewShare =
    scanRoot && viewRoot && scanRoot.byteSize > 0
      ? Math.min(1, viewRoot.byteSize / scanRoot.byteSize)
      : 1

  const selectedNode =
    selectedPath && scanRoot ? findNodeByPath(scanRoot, selectedPath) : undefined

  return (
    <div class="space-sniffer__view">
      <div class="space-sniffer__toolbar" role="toolbar" aria-label="空间嗅探工具栏">
        <div class="space-sniffer__toolbar-group">
          <IosButton size="compact" title="新建扫描标签 (⌘N)" onClick={onNewScan}>
            新建
          </IosButton>
        </div>
        <span class="space-sniffer__toolbar-sep" aria-hidden="true" />
        <div class="space-sniffer__toolbar-group">
          <IosButton size="compact" title="后退" disabled={historyIndex <= 0} onClick={goBack}>
            后退
          </IosButton>
          <IosButton
            size="compact"
            title="前进"
            disabled={historyIndex >= history.length - 1}
            onClick={goForward}
          >
            前进
          </IosButton>
          <IosButton
            size="compact"
            title="上一级"
            disabled={!viewRoot || viewRoot.path === rootPath}
            onClick={goUp}
          >
            上一级
          </IosButton>
          <IosButton size="compact" title="回到扫描根" onClick={goHome}>
            根目录
          </IosButton>
        </div>
        <span class="space-sniffer__toolbar-sep" aria-hidden="true" />
        <div class="space-sniffer__toolbar-group">
          <IosButton
            size="compact"
            tone={scanning ? 'danger' : 'secondary'}
            title={scanning ? '停止扫描' : '重新扫描'}
            onClick={() => {
              if (scanning) {
                stopScan()
              } else {
                void startScan()
              }
            }}
          >
            {scanning ? '停止' : '扫描'}
          </IosButton>
          <IosButton
            size="compact"
            title="减少细节"
            disabled={detailLevel <= MIN_DETAIL_LEVEL}
            onClick={() => setDetailLevel((value) => Math.max(MIN_DETAIL_LEVEL, value - 1))}
          >
            减少细节
          </IosButton>
          <IosButton
            size="compact"
            title="增加细节"
            disabled={detailLevel >= MAX_DETAIL_LEVEL}
            onClick={() => setDetailLevel((value) => Math.min(MAX_DETAIL_LEVEL, value + 1))}
          >
            增加细节
          </IosButton>
        </div>
      </div>

      <div class="space-sniffer__pathbar" title={viewPath}>
        <span class="space-sniffer__pathbar-label">当前位置</span>
        <span class="space-sniffer__pathbar-value">{viewPath}</span>
      </div>

      <div class="space-sniffer__stage">
        <div class="space-sniffer__share" aria-hidden="true" title="当前视图占扫描根的比例">
          <div class="space-sniffer__share-fill" style={{ height: `${viewShare * 100}%` }} />
        </div>

        <div class="space-sniffer__canvas">
          {viewRoot ? (
            <SpaceSnifferTreemap
              root={viewRoot}
              scanRootBytes={scanRoot?.byteSize ?? viewRoot.byteSize}
              detailLevel={detailLevel}
              selectedPath={selectedPath}
              onSelect={(node) => setSelectedPath(node.path)}
              onActivate={handleActivate}
              onContextMenu={handleContextMenu}
            />
          ) : (
            <div class="space-sniffer__treemap space-sniffer__treemap--empty">
              <p>{scanning ? '正在扫描…' : '暂无数据'}</p>
            </div>
          )}
        </div>
      </div>

      <div class="space-sniffer__statusbar">
        <div class="space-sniffer__status-side">
          {selectedNode ? (
            <span>
              已选：{selectedNode.name} · {formatStorageSize(selectedNode.byteSize)}
            </span>
          ) : (
            <span>细节 {detailLevel}</span>
          )}
        </div>
        <div class="space-sniffer__status-main">
          {scanning ? (
            <span>扫描中… {progress ? `${progress.fileCount} 个文件` : ''}</span>
          ) : progress?.error ? (
            <span class="space-sniffer__status-error">{progress.error}</span>
          ) : progress ? (
            <span>
              {progress.fileCount} 个文件 · {progress.folderCount} 个文件夹 ·{' '}
              {formatStorageSize(progress.root.byteSize)}
            </span>
          ) : (
            <span>准备就绪</span>
          )}
          {scanning ? (
            <span class="space-sniffer__progress" aria-label="扫描进行中">
              <span class="space-sniffer__progress-bar" />
            </span>
          ) : undefined}
        </div>
      </div>
    </div>
  )
}
