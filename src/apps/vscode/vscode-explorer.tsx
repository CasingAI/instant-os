import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { MonacoProblemTreeDecoration } from '../../monaco/monaco-markers.ts'
import { useIconContextMenu } from '../../os/icon-context-menu-context.tsx'
import { filesList, filesStat, type FilesApiEntry } from '../files/files-api.ts'
import { parseFilesAbsolutePath } from '../files/files-path.ts'
import { VscodeFileIcon, VscodeFolderIcon, VscodeTreeTwistie } from './vscode-file-icons.tsx'
import { relativeToWorkspace } from './vscode-workspace-search-ignore.ts'

type VscodeExplorerProps = {
  workspaceFolder?: string
  selectedPath?: string
  revealPath?: string
  /** 递增以强制再次展开 / 滚入视口（同一路径再次「在列表显示」） */
  revealNonce?: number
  problemDecorations?: Map<string, MonacoProblemTreeDecoration>
  onOpenFile: (path: string) => void
  onOpenFolder: () => void
  onOpenInFiles: (path: string) => void
  /** 在文件夹中查找（预填 Search include） */
  onFindInFolder?: (folderPath: string) => void
}

type TreeNodeProps = {
  entry: FilesApiEntry
  depth: number
  selectedPath?: string
  revealPath?: string
  revealNonce?: number
  problemDecorations?: Map<string, MonacoProblemTreeDecoration>
  defaultExpanded?: boolean
  workspaceFolder?: string
  onOpenFile: (path: string) => void
  onOpenInFiles: (path: string) => void
  onFindInFolder?: (folderPath: string) => void
}

function pathInWorkspace(workspaceFolder: string | undefined, path: string): boolean {
  if (!workspaceFolder) return false
  const root = workspaceFolder.replace(/\/+$/, '') || '/'
  return path === root || path.startsWith(`${root}/`)
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {
    // clipboard unavailable
  })
}

function sortEntries(entries: FilesApiEntry[]): FilesApiEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
}

function folderDisplayName(path: string, name: string): string {
  if (path === '/') return '/'
  return name || path.split('/').filter(Boolean).pop() || path
}

function decorationClassName(decoration: MonacoProblemTreeDecoration | undefined): string {
  if (!decoration) return ''
  if (decoration.errors > 0) return ' vscode__tree-item--has-error'
  if (decoration.warnings > 0) return ' vscode__tree-item--has-warning'
  return ''
}

function decorationTitle(
  path: string,
  decoration: MonacoProblemTreeDecoration | undefined,
): string {
  if (!decoration || (decoration.errors === 0 && decoration.warnings === 0)) {
    return path
  }
  const parts: string[] = []
  if (decoration.errors > 0) parts.push(`${decoration.errors} 个错误`)
  if (decoration.warnings > 0) parts.push(`${decoration.warnings} 个警告`)
  return `${path}\n${parts.join('，')}`
}

function TreeNode({
  entry,
  depth,
  selectedPath,
  revealPath,
  revealNonce = 0,
  problemDecorations,
  defaultExpanded = false,
  workspaceFolder,
  onOpenFile,
  onOpenInFiles,
  onFindInFolder,
}: TreeNodeProps) {
  const { showIconContextMenu } = useIconContextMenu()
  const isFolder = entry.kind === 'folder'
  const shouldReveal =
    revealPath !== undefined &&
    (revealPath === entry.path || revealPath.startsWith(`${entry.path}/`))
  const isRevealTarget = revealPath === entry.path
  const [expanded, setExpanded] = useState(defaultExpanded || shouldReveal)
  const [children, setChildren] = useState<FilesApiEntry[] | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const itemRef = useRef<HTMLButtonElement>(null)
  const decoration = problemDecorations?.get(entry.path)
  const problemCount = decoration ? decoration.errors + decoration.warnings : 0

  const loadChildren = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const listed = await filesList(entry.path)
      setChildren(sortEntries(listed))
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法列出目录')
      setChildren([])
    } finally {
      setLoading(false)
    }
  }, [entry.path])

  const openEntryContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const canCopyRelative = pathInWorkspace(workspaceFolder, entry.path)
      const canOpenInFiles = parseFilesAbsolutePath(entry.path) !== undefined
      showIconContextMenu(event, [
        ...(isFolder
          ? [
              {
                type: 'action' as const,
                label: '在文件夹中查找',
                disabled: !onFindInFolder,
                onClick: () => onFindInFolder?.(entry.path),
              },
              { type: 'separator' as const },
            ]
          : [
              {
                type: 'action' as const,
                label: '打开',
                onClick: () => onOpenFile(entry.path),
              },
              { type: 'separator' as const },
            ]),
        {
          type: 'action',
          label: '复制路径',
          onClick: () => copyToClipboard(entry.path),
        },
        {
          type: 'action',
          label: '复制相对路径',
          disabled: !canCopyRelative || !workspaceFolder,
          onClick: () => {
            if (!workspaceFolder) return
            copyToClipboard(relativeToWorkspace(workspaceFolder, entry.path))
          },
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '在文件中显示',
          disabled: !canOpenInFiles,
          onClick: () => onOpenInFiles(entry.path),
        },
      ])
    },
    [
      entry.path,
      isFolder,
      onFindInFolder,
      onOpenFile,
      onOpenInFiles,
      showIconContextMenu,
      workspaceFolder,
    ],
  )

  // 仅在 reveal 目标变化时自动展开；不要把 expanded 放进依赖，
  // 否则用户手动收起后会被 shouldReveal 立刻顶回去。
  useEffect(() => {
    if (!isFolder || !shouldReveal) return
    setExpanded(true)
  }, [isFolder, revealPath, revealNonce, shouldReveal])

  useEffect(() => {
    if (!isFolder || !expanded) return
    if (children !== undefined) return
    void loadChildren()
  }, [children, expanded, isFolder, loadChildren])

  useEffect(() => {
    if (!isRevealTarget) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth'
    const scroll = () => {
      itemRef.current?.scrollIntoView({ block: 'nearest', behavior })
    }
    // 父目录异步展开后节点才挂载；再补一次以覆盖布局稳定前的空滚
    const frame = window.requestAnimationFrame(scroll)
    const timer = window.setTimeout(scroll, 120)
    const timer2 = window.setTimeout(scroll, 360)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      window.clearTimeout(timer2)
    }
  }, [isRevealTarget, revealNonce, revealPath])

  if (!isFolder) {
    const selected = selectedPath === entry.path
    return (
      <button
        ref={itemRef}
        type="button"
        class={`vscode__tree-item vscode__tree-item--file${selected ? ' vscode__tree-item--selected' : ''}${decorationClassName(decoration)}`}
        style={{ paddingLeft: `${10 + depth * 12}px` }}
        title={decorationTitle(entry.path, decoration)}
        onClick={() => onOpenFile(entry.path)}
        onContextMenu={openEntryContextMenu}
      >
        <span class="vscode__tree-chevron vscode__tree-chevron--spacer" aria-hidden="true" />
        <VscodeFileIcon fileName={entry.name} selected={selected} />
        <span class="vscode__tree-label">{entry.name}</span>
        {problemCount > 0 ? (
          <span class="vscode__tree-badge" aria-hidden="true">
            {problemCount}
          </span>
        ) : undefined}
      </button>
    )
  }

  return (
    <div class="vscode__tree-folder">
      <button
        ref={itemRef}
        type="button"
        class={`vscode__tree-item vscode__tree-item--folder${selectedPath === entry.path ? ' vscode__tree-item--selected' : ''}${decorationClassName(decoration)}`}
        style={{ paddingLeft: `${10 + depth * 12}px` }}
        title={decorationTitle(entry.path, decoration)}
        onClick={() => setExpanded((value) => !value)}
        onContextMenu={openEntryContextMenu}
      >
        <span class="vscode__tree-chevron" aria-hidden="true">
          <VscodeTreeTwistie expanded={expanded} />
        </span>
        <VscodeFolderIcon expanded={expanded} selected={selectedPath === entry.path} />
        <span class="vscode__tree-label">{folderDisplayName(entry.path, entry.name)}</span>
        {problemCount > 0 ? (
          <span class="vscode__tree-badge" aria-hidden="true">
            {problemCount}
          </span>
        ) : undefined}
      </button>
      {expanded ? (
        <div class="vscode__tree-children">
          {loading ? <div class="vscode__tree-hint">加载中…</div> : undefined}
          {error ? <div class="vscode__tree-hint vscode__tree-hint--error">{error}</div> : undefined}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              revealPath={revealPath}
              revealNonce={revealNonce}
              problemDecorations={problemDecorations}
              workspaceFolder={workspaceFolder}
              onOpenFile={onOpenFile}
              onOpenInFiles={onOpenInFiles}
              onFindInFolder={onFindInFolder}
            />
          ))}
        </div>
      ) : undefined}
    </div>
  )
}

export function VscodeExplorer({
  workspaceFolder,
  selectedPath,
  revealPath,
  revealNonce = 0,
  problemDecorations,
  onOpenFile,
  onOpenFolder,
  onOpenInFiles,
  onFindInFolder,
}: VscodeExplorerProps) {
  const [root, setRoot] = useState<FilesApiEntry | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!workspaceFolder) {
      setRoot(undefined)
      setError(undefined)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const entry = await filesStat(workspaceFolder)
        if (cancelled) return
        if (!entry || entry.kind !== 'folder') {
          setRoot(undefined)
          setError('工作区文件夹不存在或不是文件夹')
          return
        }
        setRoot(entry)
        setError(undefined)
      } catch (err) {
        if (cancelled) return
        setRoot(undefined)
        setError(err instanceof Error ? err.message : '无法加载工作区')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceFolder])

  return (
    <div class="vscode__explorer">
      <div class="vscode__sidebar-header">工作区</div>
      {!workspaceFolder ? (
        <div class="vscode__explorer-empty">
          <p class="vscode__tree-hint">尚未打开文件夹</p>
          <button type="button" class="vscode__explorer-open-btn" onClick={onOpenFolder}>
            打开文件夹
          </button>
        </div>
      ) : undefined}
      {workspaceFolder && loading ? <div class="vscode__tree-hint">加载中…</div> : undefined}
      {error ? <div class="vscode__tree-hint vscode__tree-hint--error">{error}</div> : undefined}
      {root ? (
        <div class="vscode__tree">
          <TreeNode
            key={root.path}
            entry={root}
            depth={0}
            selectedPath={selectedPath}
            revealPath={revealPath}
            revealNonce={revealNonce}
            problemDecorations={problemDecorations}
            defaultExpanded
            workspaceFolder={workspaceFolder}
            onOpenFile={onOpenFile}
            onOpenInFiles={onOpenInFiles}
            onFindInFolder={onFindInFolder}
          />
        </div>
      ) : undefined}
    </div>
  )
}
