import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { materializeArchiveEntries } from '../../archive/archive-materialize.ts'
import { listArchiveInWorker } from '../../archive/archive-worker-client.ts'
import { getDefaultFileOpenApp } from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { AdaptiveActionMenu, type AdaptiveActionMenuItem } from '../../ui/adaptive-action-menu.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosTextField } from '../../ui/ios-text-field.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { ArchiveUtilityIcon } from '../../icons/app-icons.tsx'
import { FilesNodeIcon } from '../files/files-node-icon.tsx'
import {
  filesCreateArchive,
  filesCreateBinary,
  filesDecodeArchive,
  filesExtractArchive,
  filesList,
  filesReadBlob,
  filesRemoveBatch,
  filesStat,
} from '../files/files-api.ts'
import { ensureTmpFolder } from '../files/files-tmp.ts'
import { FilesStorageFullError } from '../files/files-storage.ts'
import { ARCHIVE_UTILITY_OPEN_EXTENSIONS, stripArchiveExtension } from './archive-utility-format.ts'
import {
  allocateUniqueFileName,
  remapEntriesAwayFromExisting,
} from './archive-utility-conflict.ts'
import {
  buildArchiveLevel,
  filterEntriesBySelection,
  fileTypeLabel,
  formatArchiveBytes,
  formatArchiveDateTime,
  formatArchiveRatio,
  type ArchiveSession,
  type ArchiveLevelItem,
} from './archive-utility-tree.ts'
import { applyArchiveRewrite } from './archive-utility-rewrite.ts'
import './archive-utility.css'

const APP_ID = 'archive-utility' as const
const THEME = '#6b7280'
const EMPTY_TITLE = '压缩包实用工具'
/** 预览提取的临时目录（每次预览前清空） */
const PREVIEW_ROOT = '/tmp/ArchivePreview'

type ArchiveUtilityAppProps = {
  windowId?: string
}

type BusyState =
  | {
      kind: 'extract'
      label: string
      done: number
      total: number
      bytesWritten: number
      currentPath?: string
    }
  | {
      kind: 'create'
      label: string
      readCount: number
      totalCount: number
      currentPath?: string
    }
  | {
      kind: 'rewrite'
      label: string
    }

function fileBaseName(absolutePath: string): string {
  const parts = absolutePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? absolutePath
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) {
    if (error.name === 'AbortError' || error.message === 'aborted') return '操作已取消'
    return error.message
  }
  return '操作失败'
}

function formatFormatLabel(format: ArchiveSession['format']): string {
  switch (format) {
    case 'zip':
      return 'ZIP'
    case 'tar':
      return 'TAR'
    case 'gzip-tar':
      return 'TAR.GZ'
    case 'gzip-file':
      return 'GZIP'
  }
}

export function ArchiveUtilityApp({ windowId }: ArchiveUtilityAppProps) {
  const {
    windows,
    activeWindowId,
    setWindowTitle,
    setWindowDocumentId,
    openApp,
    registerWindowCloseGuard,
  } = useOs()
  const modal = useWindowModal()
  const { showSystemOpenDialog, dialog: systemOpenDialog } = useSystemOpenDialog()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const documentId = appWindow?.documentId
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  const [session, setSession] = useState<ArchiveSession | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [currentDir, setCurrentDir] = useState<string[]>([])
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<BusyState | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<
    { item: ArchiveLevelItem; x: number; y: number } | undefined
  >(undefined)
  const [createDialog, setCreateDialog] = useState<
    { sourcePath: string; destDir: string; sourceName: string } | undefined
  >(undefined)
  const [createFormat, setCreateFormat] = useState<'zip' | 'gzip-tar'>('zip')
  const [createName, setCreateName] = useState('')

  const { hostRef: narrowHostRef, narrowLayout } = useAppNarrowLayout()

  const busyAbortRef = useRef<AbortController | undefined>(undefined)
  const sessionRef = useRef(session)
  const selectionRef = useRef(selection)
  const currentDirRef = useRef(currentDir)
  const mountedRef = useRef(true)
  const documentIdRef = useRef(documentId)
  sessionRef.current = session
  selectionRef.current = selection
  currentDirRef.current = currentDir
  documentIdRef.current = documentId

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      busyAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!windowId) return
    registerWindowCloseGuard(windowId, () => {
      busyAbortRef.current?.abort()
      return true
    })
    return () => registerWindowCloseGuard(windowId, undefined)
  }, [registerWindowCloseGuard, windowId])

  const loadArchive = useCallback(
    async (archivePath: string, signal: AbortSignal): Promise<void> => {
      setLoading(true)
      setLoadError(undefined)
      setCurrentDir([])
      setSelection(new Set())
      try {
        const stat = await filesStat(archivePath)
        if (!stat || stat.kind !== 'file') {
          throw new Error('找不到压缩包')
        }
        signal.throwIfAborted()
        const blob = await filesReadBlob(archivePath)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const listing = await listArchiveInWorker({ bytes, format: 'auto', signal })
        if (!mountedRef.current || documentIdRef.current !== archivePath) return
        let entries = listing.entries
        if (listing.format === 'gzip-file') {
          // 单文件 gzip：以去掉后缀的名字作为条目名，方便直接解压/预览
          const displayName = stripArchiveExtension(stat.name) || 'archive'
          const first = entries[0]
          entries = first ? [{ ...first, path: displayName }] : []
        }
        setSession({
          archivePath,
          fileName: stat.name,
          format: listing.format,
          entries,
        })
      } catch (error) {
        if (signal.aborted || !mountedRef.current || documentIdRef.current !== archivePath) return
        setSession(undefined)
        setLoadError(formatError(error))
      } finally {
        if (mountedRef.current && documentIdRef.current === archivePath) {
          setLoading(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (!documentId) {
      setSession(undefined)
      setLoadError(undefined)
      setLoading(false)
      return
    }
    const abort = new AbortController()
    void loadArchive(documentId, abort.signal)
    return () => abort.abort()
  }, [documentId, loadArchive])

  useEffect(() => {
    if (!windowId) return
    if (session) {
      setWindowTitle(windowId, `${EMPTY_TITLE} — ${session.fileName}`)
    } else {
      setWindowTitle(windowId, EMPTY_TITLE)
    }
  }, [setWindowTitle, windowId, session])

  const handleOpenArchive = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '打开压缩包',
      selectionMode: 'file',
      acceptExtensions: [...ARCHIVE_UTILITY_OPEN_EXTENSIONS],
    })
    if (!path) return
    if (windowId) setWindowDocumentId(windowId, path)
  }, [setWindowDocumentId, showSystemOpenDialog, windowId])

  const handleRefresh = useCallback(() => {
    const current = documentIdRef.current
    if (!current) return
    const abort = new AbortController()
    void loadArchive(current, abort.signal)
  }, [loadArchive])

  const pickExtractTarget = useCallback(async (): Promise<string | undefined> => {
    const destPath = await showSystemOpenDialog({
      title: '选择解压目标文件夹',
      selectionMode: 'folder',
    })
    if (!destPath) return undefined
    const destStat = await filesStat(destPath)
    if (!destStat || destStat.kind !== 'folder') {
      await modal.alert({ title: '无法解压', message: '目标文件夹不存在', themeColor: THEME })
      return undefined
    }
    if (!destStat.writable) {
      await modal.alert({ title: '无法解压', message: '目标文件夹不可写', themeColor: THEME })
      return undefined
    }
    return destPath
  }, [modal, showSystemOpenDialog])

  const handleExtract = useCallback(
    async (onlySelected: boolean) => {
      const current = sessionRef.current
      if (!current) return
      const destPath = await pickExtractTarget()
      if (!destPath) return

      const abort = new AbortController()
      busyAbortRef.current = abort
      setBusy({ kind: 'extract', label: '正在解压…', done: 0, total: 0, bytesWritten: 0 })

      const report = (progress: { done: number; total: number; bytesWritten: number; currentPath?: string }) => {
        setBusy({
          kind: 'extract',
          label: `正在解压到「${fileBaseName(destPath)}」…`,
          done: progress.done,
          total: progress.total,
          bytesWritten: progress.bytesWritten,
          currentPath: progress.currentPath,
        })
      }

      try {
        let fileCount = 0
        if (current.format === 'gzip-file') {
          const blob = await filesReadBlob(current.archivePath)
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const decoded = await filesDecodeArchive({
            bytes,
            format: 'gzip-file',
            signal: abort.signal,
          })
          const inflated = decoded.get('data')
          if (!inflated) {
            throw new Error('无法解压该 gzip 文件（文件可能已损坏）')
          }
          const desiredName = stripArchiveExtension(current.fileName) || 'archive'
          const outName = await allocateUniqueFileName(destPath, desiredName)
          const written = await materializeArchiveEntries({
            destRoot: destPath,
            entries: [{ relativePath: outName, bytes: inflated }],
            signal: abort.signal,
            onProgress: report,
          })
          fileCount = written.fileCount
        } else {
          const selectionSnapshot = selectionRef.current
          const result = await filesExtractArchive({
            archivePath: current.archivePath,
            destDirPath: destPath,
            format: current.format,
            stripRoot: false,
            transformEntries: async (entries) => {
              let selected = entries
              if (onlySelected && selectionSnapshot.size > 0) {
                selected = filterEntriesBySelection(entries, selectionSnapshot)
              }
              return remapEntriesAwayFromExisting(destPath, selected)
            },
            signal: abort.signal,
            onProgress: report,
          })
          fileCount = result.fileCount
        }
        await modal.alert({
          title: '解压完成',
          message:
            fileCount > 0
              ? `已解压 ${fileCount} 个文件到「${destPath}」`
              : '归档中没有可解压的内容',
          confirmLabel: '好',
          themeColor: THEME,
        })
      } catch (error) {
        if (abort.signal.aborted) return
        await modal.alert({ title: '无法解压', message: formatError(error), themeColor: THEME })
      } finally {
        busyAbortRef.current = undefined
        if (mountedRef.current) setBusy(undefined)
      }
    },
    [modal, pickExtractTarget],
  )

  const handleCreateArchive = useCallback(async () => {
    const sourcePath = await showSystemOpenDialog({
      title: '选择要压缩的文件夹',
      selectionMode: 'folder',
    })
    if (!sourcePath) return
    const sourceStat = await filesStat(sourcePath)
    if (!sourceStat || sourceStat.kind !== 'folder') {
      await modal.alert({ title: '无法新建归档', message: '源文件夹不存在', themeColor: THEME })
      return
    }
    const destDir = await showSystemOpenDialog({
      title: '选择归档保存位置',
      selectionMode: 'folder',
    })
    if (!destDir) return
    const destStat = await filesStat(destDir)
    if (!destStat || destStat.kind !== 'folder') {
      await modal.alert({ title: '无法新建归档', message: '目标文件夹不存在', themeColor: THEME })
      return
    }
    const sourceName = fileBaseName(sourcePath)
    setCreateFormat('zip')
    setCreateName(`${sourceName}.zip`)
    setCreateDialog({ sourcePath, destDir, sourceName })
  }, [modal, showSystemOpenDialog])

  const performCreateArchive = useCallback(
    async (sourcePath: string, destDir: string, format: 'zip' | 'gzip-tar', fileName: string) => {
      setCreateDialog(undefined)
      const extension = format === 'zip' ? 'zip' : 'tar.gz'
      const finalName = /\.(zip|tar\.gz|tgz)$/i.test(fileName.trim())
        ? fileName.trim()
        : `${fileName.trim()}.${extension}`
      const archivePath = `${destDir.replace(/\/+$/, '')}/${finalName}`

      const existing = await filesStat(archivePath)
      if (existing) {
        const overwrite = await modal.confirm({
          title: '覆盖已有文件？',
          message: `「${finalName}」已存在，覆盖它吗？`,
          confirmLabel: '覆盖',
          themeColor: THEME,
        })
        if (!overwrite) return
      }

      const abort = new AbortController()
      busyAbortRef.current = abort
      setBusy({ kind: 'create', label: '正在压缩…', readCount: 0, totalCount: 0 })
      try {
        await filesCreateArchive({
          sourceDirPath: sourcePath,
          archivePath,
          format,
          signal: abort.signal,
          onProgress: (progress) => {
            setBusy({
              kind: 'create',
              label: `正在压缩「${fileBaseName(sourcePath)}」…`,
              readCount: progress.readCount,
              totalCount: progress.totalCount,
              currentPath: progress.currentPath,
            })
          },
        })
        await modal.alert({
          title: '新建完成',
          message: `已创建「${finalName}」`,
          confirmLabel: '好',
          themeColor: THEME,
        })
      } catch (error) {
        if (abort.signal.aborted) return
        await modal.alert({ title: '无法新建归档', message: formatError(error), themeColor: THEME })
      } finally {
        busyAbortRef.current = undefined
        if (mountedRef.current) setBusy(undefined)
      }
    },
    [modal],
  )

  const cancelBusy = useCallback(() => {
    busyAbortRef.current?.abort()
  }, [])

  const runRewrite = useCallback(
    async (params: {
      label: string
      message: string
      transform: (
        entries: Map<string, Uint8Array>,
      ) => Map<string, Uint8Array> | Promise<Map<string, Uint8Array>>
    }): Promise<boolean> => {
      const current = sessionRef.current
      if (!current || current.format === 'gzip-file') return false
      const abort = new AbortController()
      busyAbortRef.current = abort
      setBusy({ kind: 'rewrite', label: params.label })
      try {
        const result = await applyArchiveRewrite({
          archivePath: current.archivePath,
          format: current.format,
          signal: abort.signal,
          transform: params.transform,
        })
        setSelection(new Set())
        handleRefresh()
        await modal.alert({
          title: '修改完成',
          message: `${params.message} 归档现在包含 ${result.entryCount} 个条目。`,
          confirmLabel: '好',
          themeColor: THEME,
        })
        return true
      } catch (error) {
        if (abort.signal.aborted) return false
        await modal.alert({ title: '无法修改归档', message: formatError(error), themeColor: THEME })
        return false
      } finally {
        busyAbortRef.current = undefined
        if (mountedRef.current) setBusy(undefined)
      }
    },
    [handleRefresh, modal],
  )

  const handleDeleteSelected = useCallback(async () => {
    const current = sessionRef.current
    if (!current || current.format === 'gzip-file') return
    const selected = selectionRef.current
    if (selected.size === 0) return
    const ok = await modal.confirm({
      title: '从归档中删除？',
      message: `将从归档中删除选中的 ${selected.size} 项，并重写归档文件。`,
      confirmLabel: '删除',
      confirmTone: 'danger',
      themeColor: THEME,
    })
    if (!ok) return
    const paths = new Set(selected)
    const prefixes = [...paths].map((path) => `${path}/`)
    await runRewrite({
      label: '正在从归档中删除…',
      message: '已删除选中内容。',
      transform: (entries) => {
        const out = new Map<string, Uint8Array>()
        for (const [path, data] of entries) {
          if (paths.has(path)) continue
          if (prefixes.some((prefix) => path.startsWith(prefix))) continue
          out.set(path, data)
        }
        return out
      },
    })
  }, [modal, runRewrite])

  const handleRenameSelected = useCallback(async () => {
    const current = sessionRef.current
    if (!current || current.format === 'gzip-file') return
    const selected = [...selectionRef.current]
    if (selected.length !== 1) return
    const targetPath = selected[0]!
    const target = current.entries.find((entry) => entry.path === targetPath)
    if (!target) return
    const oldName = targetPath.split('/').pop() ?? targetPath
    const newName = await modal.prompt({
      title: target.isDirectory ? '重命名文件夹' : '重命名文件',
      label: '名称',
      initialValue: oldName,
      requireValue: true,
      validate: (value) => {
        const trimmed = value.trim()
        if (!trimmed) return '请输入名称'
        if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
          return '名称不能包含 / \\ 或空字符'
        }
        return undefined
      },
      themeColor: THEME,
    })
    if (!newName) return
    const finalName = newName.trim()
    if (finalName === oldName) return
    const parent = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : ''
    const nextPath = parent ? `${parent}/${finalName}` : finalName
    const prefix = `${targetPath}/`
    await runRewrite({
      label: '正在重命名…',
      message: '已重命名。',
      transform: (entries) => {
        const out = new Map<string, Uint8Array>()
        for (const [path, data] of entries) {
          if (path === targetPath) {
            out.set(nextPath, data)
          } else if (path.startsWith(prefix)) {
            out.set(`${nextPath}/${path.slice(prefix.length)}`, data)
          } else {
            out.set(path, data)
          }
        }
        return out
      },
    })
  }, [modal, runRewrite])

  const handleAddFiles = useCallback(async () => {
    const current = sessionRef.current
    if (!current || current.format === 'gzip-file') return
    const filePath = await showSystemOpenDialog({
      title: '选择要添加的文件',
      selectionMode: 'file',
    })
    if (!filePath) return
    const stat = await filesStat(filePath)
    if (!stat || stat.kind !== 'file') return
    const fileName = fileBaseName(filePath)
    const dirSegments = currentDirRef.current
    const targetPath =
      dirSegments.length > 0 ? `${dirSegments.join('/')}/${fileName}` : fileName
    const ok = await runRewrite({
      label: '正在添加文件…',
      message: `已添加「${fileName}」。`,
      transform: async (entries) => {
        const blob = await filesReadBlob(filePath)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const out = new Map(entries)
        out.set(targetPath, bytes)
        return out
      },
    })
    if (!ok) return
  }, [runRewrite, showSystemOpenDialog])

  /** 双击文件：提取字节到 /tmp/ArchivePreview 后用默认程序打开 */
  const handleOpenEntry = useCallback(
    async (entry: ArchiveLevelItem) => {
      if (entry.kind !== 'file') return
      const current = sessionRef.current
      if (!current) return
      const abort = new AbortController()
      busyAbortRef.current = abort
      setBusy({ kind: 'rewrite', label: '正在提取文件…' })
      try {
        const blob = await filesReadBlob(current.archivePath)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const decoded = await filesDecodeArchive({
          bytes,
          format: current.format,
          stripRoot: false,
          signal: abort.signal,
        })
        const data = decoded.get(entry.path)
        if (!data) throw new Error('找不到该文件')
        await ensureTmpFolder(PREVIEW_ROOT)
        const existing = await filesList(PREVIEW_ROOT)
        if (existing.length > 0) {
          await filesRemoveBatch(existing.map((item) => item.path))
        }
        const name = entry.path.split('/').pop() ?? entry.path
        const targetPath = `${PREVIEW_ROOT}/${name}`
        const copy = new Uint8Array(data.byteLength)
        copy.set(data)
        // filesWriteBinary 只能覆写已存在文件；这里用 filesCreateBinary 新建
        await filesCreateBinary(targetPath, copy.buffer as ArrayBuffer)
        const appId = getDefaultFileOpenApp(name)
        if (appId) {
          openApp(appId, { documentId: targetPath })
        } else {
          await modal.alert({
            title: '无法打开',
            message: `没有可用来打开「${name}」的程序。`,
            confirmLabel: '好',
            themeColor: THEME,
          })
        }
      } catch (error) {
        if (abort.signal.aborted) return
        await modal.alert({ title: '无法打开文件', message: formatError(error), themeColor: THEME })
      } finally {
        busyAbortRef.current = undefined
        if (mountedRef.current) setBusy(undefined)
      }
    },
    [modal, openApp],
  )

  const handleEnterDir = useCallback((dirPath: string, name: string) => {
    const parts = dirPath ? dirPath.split('/') : []
    setCurrentDir([...parts, name])
    setSelection(new Set())
  }, [])

  const handleSelectItem = useCallback((path: string, additive: boolean) => {
    const current = selectionRef.current
    if (additive) {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      setSelection(next)
      return
    }
    setSelection(new Set([path]))
  }, [])

  const handleGoToBreadcrumb = useCallback((depth: number) => {
    setCurrentDir(currentDir.slice(0, depth))
    setSelection(new Set())
  }, [currentDir])

  const handleContextMenu = useCallback(
    (item: ArchiveLevelItem, event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (!selectionRef.current.has(item.path)) {
        setSelection(new Set([item.path]))
      }
      setContextMenu({ item, x: event.clientX, y: event.clientY })
    },
    [],
  )

  const closeContextMenu = useCallback(() => setContextMenu(undefined), [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const items: MenuDefinition[] = [
      {
        label: EMPTY_TITLE,
        items: [
          { type: 'action', label: '打开压缩包…', shortcut: '⌘O', onClick: () => void handleOpenArchive() },
          { type: 'action', label: '新建归档…', shortcut: '⌘N', onClick: () => void handleCreateArchive() },
          { type: 'separator' },
          { type: 'action', label: '全部解压…', shortcut: '⇧⌘E', onClick: () => void handleExtract(false) },
          {
            type: 'action',
            label: '解压选中…',
            disabled: selection.size === 0,
            onClick: () => void handleExtract(true),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '添加文件…',
            disabled: !session || session.format === 'gzip-file',
            onClick: () => void handleAddFiles(),
          },
          {
            type: 'action',
            label: '删除选中',
            disabled: !session || selection.size === 0 || session.format === 'gzip-file',
            onClick: () => void handleDeleteSelected(),
          },
          {
            type: 'action',
            label: '重命名选中',
            disabled: !session || selection.size !== 1 || session.format === 'gzip-file',
            onClick: () => void handleRenameSelected(),
          },
        ],
      },
      {
        label: '显示',
        items: [
          { type: 'action', label: '刷新', shortcut: '⌘R', onClick: () => handleRefresh() },
          { type: 'action', label: '返回上级', disabled: currentDir.length === 0, onClick: () => handleGoToBreadcrumb(currentDir.length - 1) },
        ],
      },
    ]
    return items
  }, [
    currentDir.length,
    handleAddFiles,
    handleCreateArchive,
    handleDeleteSelected,
    handleExtract,
    handleGoToBreadcrumb,
    handleOpenArchive,
    handleRefresh,
    handleRenameSelected,
    selection.size,
    session,
  ])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  const level = session ? buildArchiveLevel(session.entries, currentDir) : []
  const selectedCount = selection.size
  const totalOriginal = useMemo(
    () => (session ? session.entries.reduce((acc, entry) => acc + entry.originalSize, 0) : 0),
    [session],
  )
  const totalCompressed = useMemo(
    () => (session ? session.entries.reduce((acc, entry) => acc + entry.compressedSize, 0) : 0),
    [session],
  )

  const contextMenuItems = useMemo((): AdaptiveActionMenuItem[] => {
    const target = contextMenu?.item
    if (!target) return []
    const items: AdaptiveActionMenuItem[] = []
    if (target.kind === 'dir') {
      items.push({
        type: 'action',
        label: '打开',
        onClick: () => handleEnterDir(target.path, target.name),
      })
    } else {
      items.push({
        type: 'action',
        label: '打开',
        onClick: () => void handleOpenEntry(target),
      })
    }
    items.push({ type: 'separator' })
    items.push({
      type: 'action',
      label: '全部解压…',
      disabled: !session,
      onClick: () => void handleExtract(false),
    })
    items.push({
      type: 'action',
      label: `解压选中${selectedCount > 0 ? `（${selectedCount}）` : ''}`,
      disabled: !session || selectedCount === 0,
      onClick: () => void handleExtract(true),
    })
    if (session && session.format !== 'gzip-file') {
      items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: '删除选中',
        disabled: selectedCount === 0,
        onClick: () => void handleDeleteSelected(),
      })
      items.push({
        type: 'action',
        label: '重命名',
        disabled: selectedCount !== 1,
        onClick: () => void handleRenameSelected(),
      })
    }
    return items
  }, [
    contextMenu,
    handleDeleteSelected,
    handleEnterDir,
    handleExtract,
    handleOpenEntry,
    handleRenameSelected,
    selectedCount,
    session,
  ])

  const renderToolbar = () => (
    <div class="archive-utility-app__toolbar">
      <IosButton size="compact" onClick={() => void handleOpenArchive()}>
        打开
      </IosButton>
      <IosButton
        size="compact"
        onClick={() => void handleExtract(false)}
        disabled={!session || busy !== undefined}
      >
        全部解压
      </IosButton>
      <IosButton
        size="compact"
        onClick={() => void handleExtract(true)}
        disabled={!session || selectedCount === 0 || busy !== undefined}
      >
        解压选中{selectedCount > 0 ? `（${selectedCount}）` : ''}
      </IosButton>
      <span class="archive-utility-app__toolbar-sep" aria-hidden="true" />
      <IosButton
        size="compact"
        onClick={() => void handleAddFiles()}
        disabled={!session || session.format === 'gzip-file' || busy !== undefined}
      >
        添加文件
      </IosButton>
      <IosButton
        size="compact"
        onClick={() => void handleDeleteSelected()}
        disabled={!session || selectedCount === 0 || session.format === 'gzip-file' || busy !== undefined}
      >
        删除选中
      </IosButton>
      <span class="archive-utility-app__toolbar-sep" aria-hidden="true" />
      <IosButton
        size="compact"
        onClick={() => void handleCreateArchive()}
        disabled={busy !== undefined}
      >
        新建归档
      </IosButton>
      <span class="archive-utility-app__toolbar-spacer" aria-hidden="true" />
      <IosButton size="compact" onClick={handleRefresh} disabled={!session || busy !== undefined}>
        刷新
      </IosButton>
    </div>
  )

  const renderBreadcrumb = () => {
    const crumbs = [{ name: session?.fileName ?? '归档', depth: 0 }, ...currentDir.map((name, index) => ({ name, depth: index + 1 }))]
    return (
      <div class="archive-utility-app__pathbar">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.depth}-${crumb.name}`} class="archive-utility-app__crumb">
            {index > 0 ? <span class="archive-utility-app__crumb-sep" aria-hidden="true">/</span> : undefined}
            <button
              type="button"
              class={`archive-utility-app__crumb-btn${index === crumbs.length - 1 ? ' archive-utility-app__crumb-btn--current' : ''}`}
              onClick={() => handleGoToBreadcrumb(crumb.depth)}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>
    )
  }

  const renderStatusBar = () => {
    if (!session) return null
    const levelCount = level.length
    const levelBytes = level.reduce((acc, item) => acc + (item.kind === 'file' ? item.meta.originalSize : 0), 0)
    return (
      <div class="archive-utility-app__statusbar">
        <span>{formatFormatLabel(session.format)}</span>
        <span>{session.entries.length} 个条目</span>
        <span>
          原始 {formatArchiveBytes(totalOriginal)} · 压缩 {formatArchiveBytes(totalCompressed)}
        </span>
        {selectedCount > 0 ? <span>已选中 {selectedCount} 项</span> : undefined}
        <span class="archive-utility-app__statusbar-right">
          当前 {levelCount} 项 · {formatArchiveBytes(levelBytes)}
        </span>
      </div>
    )
  }

  const renderEmpty = () => (
    <div class="archive-utility-app__empty">
      <div class="archive-utility-app__empty-icon" aria-hidden="true">
        <ArchiveUtilityIcon size={44} />
      </div>
      <p class="archive-utility-app__empty-title">未打开压缩包</p>
      <p class="archive-utility-app__empty-hint">打开一个 .zip、.tar、.tar.gz 或 .gz 文件以浏览其内容。</p>
      <div class="archive-utility-app__empty-actions">
        <IosButton tone="primary" onClick={() => void handleOpenArchive()}>
          打开压缩包…
        </IosButton>
      </div>
    </div>
  )

  const renderLoading = () => (
    <div class="archive-utility-app__empty">
      <p class="archive-utility-app__empty-title">正在读取压缩包…</p>
    </div>
  )

  const renderError = () => (
    <div class="archive-utility-app__empty">
      <p class="archive-utility-app__empty-title">无法打开压缩包</p>
      <p class="archive-utility-app__empty-hint">{loadError}</p>
      <div class="archive-utility-app__empty-actions">
        <IosButton tone="primary" onClick={() => void handleOpenArchive()}>
          选择其他文件
        </IosButton>
        {documentId ? (
          <IosButton size="compact" onClick={handleRefresh}>
            重试
          </IosButton>
        ) : undefined}
      </div>
    </div>
  )

  const renderTable = () => (
    <div class="archive-utility-app__table" role="table" aria-label="压缩包内容">
      <div class="archive-utility-app__table-head" role="row">
        <span role="columnheader" class="archive-utility-app__col archive-utility-app__col--name">名称</span>
        <span role="columnheader" class="archive-utility-app__col archive-utility-app__col--type">类型</span>
        <span role="columnheader" class="archive-utility-app__col archive-utility-app__col--size">原始大小</span>
        <span role="columnheader" class="archive-utility-app__col archive-utility-app__col--size">压缩后</span>
        <span role="columnheader" class="archive-utility-app__col archive-utility-app__col--ratio">压缩率</span>
        <span role="columnheader" class="archive-utility-app__col archive-utility-app__col--time">修改时间</span>
        <span role="columnheader" class="archive-utility-app__col archive-utility-app__col--method">方法</span>
      </div>
      <div class="archive-utility-app__table-body" role="rowgroup">
        {level.length === 0 ? (
          <div class="archive-utility-app__table-empty" role="row">
            <span>此文件夹为空</span>
          </div>
        ) : (
          level.map((item) => {
            const isDir = item.kind === 'dir'
            const meta = isDir ? undefined : item.meta
            const selected = selection.has(item.path)
            return (
              <button
                type="button"
                role="row"
                aria-selected={selected}
                key={item.path}
                class={`archive-utility-app__row${selected ? ' archive-utility-app__row--selected' : ''}`}
                onClick={(event) => {
                  const additive = event.metaKey || event.ctrlKey || event.shiftKey
                  handleSelectItem(item.path, additive)
                }}
                onDblClick={() => {
                  if (isDir) {
                    handleEnterDir(item.path, item.name)
                  } else {
                    void handleOpenEntry(item)
                  }
                }}
                onContextMenu={(event) => handleContextMenu(item, event)}
              >
                <span class="archive-utility-app__col archive-utility-app__col--name archive-utility-app__cell-name">
                  <span class="archive-utility-app__cell-icon">
                    <FilesNodeIcon
                      size="list"
                      node={{
                        id: `archive-virtual-${item.path}`,
                        locationId: 'tmp',
                        parentId: undefined,
                        name: item.name,
                        kind: isDir ? 'folder' : 'file',
                        mimeType: undefined,
                        byteSize: meta?.originalSize ?? 0,
                        createdAt: meta?.mtime ?? 0,
                        updatedAt: meta?.mtime ?? 0,
                        attributes: { readable: true, writable: false },
                      }}
                    />
                  </span>
                  <span class="archive-utility-app__cell-text">{item.name}</span>
                </span>
                <span class="archive-utility-app__col archive-utility-app__col--type">
                  {isDir ? '文件夹' : meta ? fileTypeLabel(meta) : ''}
                </span>
                <span class="archive-utility-app__col archive-utility-app__col--size">
                  {isDir ? '—' : meta ? formatArchiveBytes(meta.originalSize) : ''}
                </span>
                <span class="archive-utility-app__col archive-utility-app__col--size">
                  {isDir ? '—' : meta ? formatArchiveBytes(meta.compressedSize) : ''}
                </span>
                <span class="archive-utility-app__col archive-utility-app__col--ratio">
                  {isDir || !meta ? '—' : formatArchiveRatio(meta.originalSize, meta.compressedSize) ?? '—'}
                </span>
                <span class="archive-utility-app__col archive-utility-app__col--time">
                  {meta ? formatArchiveDateTime(meta.mtime) : '—'}
                </span>
                <span class="archive-utility-app__col archive-utility-app__col--method">
                  {isDir ? '' : meta?.compressionMethod ?? ''}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )

  const renderCreateDialog = () => {
    if (!createDialog) return null
    const extension = createFormat === 'zip' ? 'zip' : 'tar.gz'
    return (
      <div class="archive-utility-app__busy" role="dialog" aria-label="新建归档">
        <div class="archive-utility-app__busy-card archive-utility-app__create-card">
          <p class="archive-utility-app__busy-title">新建归档</p>
          <p class="archive-utility-app__create-source">
            压缩「{createDialog.sourceName}」到「{createDialog.destDir}」
          </p>
          <div class="archive-utility-app__create-row">
            <span class="archive-utility-app__create-label">格式</span>
            <SegmentedControl
              value={createFormat}
              onChange={setCreateFormat}
              ariaLabel="压缩格式"
              items={[
                { id: 'zip', label: 'ZIP' },
                { id: 'gzip-tar', label: 'TAR.GZ' },
              ]}
            />
          </div>
          <div class="archive-utility-app__create-row">
            <span class="archive-utility-app__create-label">文件名</span>
            <IosTextField
              class="archive-utility-app__create-name"
              value={createName}
              onInput={(event) => setCreateName((event.target as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (createName.trim()) {
                    void performCreateArchive(
                      createDialog.sourcePath,
                      createDialog.destDir,
                      createFormat,
                      createName,
                    )
                  }
                }
              }}
            />
            <span class="archive-utility-app__create-extension">.{extension}</span>
          </div>
          <div class="archive-utility-app__create-actions">
            <IosButton size="compact" onClick={() => setCreateDialog(undefined)}>
              取消
            </IosButton>
            <IosButton
              size="compact"
              tone="primary"
              disabled={!createName.trim()}
              onClick={() =>
                void performCreateArchive(
                  createDialog.sourcePath,
                  createDialog.destDir,
                  createFormat,
                  createName,
                )
              }
            >
              创建
            </IosButton>
          </div>
        </div>
      </div>
    )
  }

  const renderBusyOverlay = () => {
    if (!busy) return null
    const currentPath =
      busy.kind === 'extract' || busy.kind === 'create' ? busy.currentPath : undefined
    const fraction =
      busy.kind === 'extract'
        ? busy.total > 0
          ? Math.min(1, busy.done / busy.total)
          : undefined
        : busy.kind === 'create'
          ? busy.totalCount > 0
            ? Math.min(1, busy.readCount / busy.totalCount)
            : undefined
          : undefined
    return (
      <div class="archive-utility-app__busy" role="dialog" aria-label="操作进度">
        <div class="archive-utility-app__busy-card">
          <p class="archive-utility-app__busy-title">{busy.label}</p>
          <div class="archive-utility-app__busy-track" role="progressbar" aria-valuenow={fraction !== undefined ? Math.round(fraction * 100) : undefined}>
            <div
              class="archive-utility-app__busy-fill archive-utility-app__busy-fill--indeterminate"
              style={fraction !== undefined ? { width: `${Math.round(fraction * 100)}%` } : undefined}
            />
          </div>
          <p class="archive-utility-app__busy-meta">
            {busy.kind === 'extract'
              ? busy.total > 0
                ? `${busy.done}/${busy.total} · ${formatArchiveBytes(busy.bytesWritten)}`
                : '准备中…'
              : busy.kind === 'create'
                ? busy.totalCount > 0
                  ? `${busy.readCount}/${busy.totalCount}`
                  : '正在读取文件…'
                : '正在处理…'}
            {currentPath ? <span class="archive-utility-app__busy-path"> · {currentPath}</span> : undefined}
          </p>
          <div class="archive-utility-app__busy-actions">
            <IosButton size="compact" onClick={cancelBusy}>
              取消
            </IosButton>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div class="archive-utility-app" ref={narrowHostRef}>
      {!documentId ? (
        <div class="archive-utility-app__frame">
          {renderToolbar()}
          <div class="archive-utility-app__content">{renderEmpty()}</div>
        </div>
      ) : loading ? (
        <div class="archive-utility-app__frame">
          {renderToolbar()}
          <div class="archive-utility-app__content">{renderLoading()}</div>
        </div>
      ) : loadError || !session ? (
        <div class="archive-utility-app__frame">
          {renderToolbar()}
          <div class="archive-utility-app__content">{renderError()}</div>
        </div>
      ) : (
        <div class="archive-utility-app__frame">
          {renderToolbar()}
          {renderBreadcrumb()}
          <div class="archive-utility-app__content">{renderTable()}</div>
          {renderStatusBar()}
        </div>
      )}
      <AdaptiveActionMenu
        open={contextMenu !== undefined}
        title={contextMenu?.item.name ?? ''}
        items={contextMenuItems}
        narrowLayout={narrowLayout}
        mount="portal"
        anchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : undefined}
        onClose={closeContextMenu}
      />
      {renderCreateDialog()}
      {renderBusyOverlay()}
      {systemOpenDialog}
    </div>
  )
}
