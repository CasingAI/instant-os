import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { MonacoEditor, type MonacoRevealPosition } from '../../monaco/monaco-editor.tsx'
import { useIconContextMenu } from '../../os/icon-context-menu-context.tsx'
import { parseFilesAbsolutePath } from '../files/files-path.ts'
import type { VscodePrefs } from './vscode-prefs.ts'
import { VscodeMarkdownPreview } from './vscode-markdown-preview.tsx'
import {
  type VscodeEditorDragPayload,
  type VscodeEditorGroupState,
  type VscodeEditorLayoutState,
  type VscodeGroupItem,
  type VscodeLayoutNode,
  type VscodeSplitEdge,
  VSCODE_EDITOR_DRAG_MIME,
  getActiveEditorDrag,
  getGroupActiveItem,
  setActiveEditorDrag,
} from './vscode-editor-layout.ts'
import { isVscodeTabDirty, type VscodeTab } from './vscode-tabs.ts'
import { relativeToWorkspace } from './vscode-workspace-search-ignore.ts'

type DropZone = VscodeSplitEdge

type VscodeEditorAreaProps = {
  layout: VscodeEditorLayoutState
  tabs: readonly VscodeTab[]
  loading: boolean
  dialogBlocked: boolean
  isActiveWindow: boolean
  prefs: {
    theme: VscodePrefs['theme']
    fontSize: number
    minimap: boolean
    wordWrap: boolean
  }
  revealPosition: (MonacoRevealPosition & { path: string }) | undefined
  onRevealPositionApplied: () => void
  onFocusGroup: (groupId: string) => void
  onActivateItem: (groupId: string, itemId: string) => void
  onCloseFileTab: (tabId: string) => void
  onClosePreview: (itemId: string) => void
  onCloseOtherInGroup: (groupId: string, keepItemId: string) => void
  onRevealInExplorer: (path: string) => void
  onOpenInFiles: (path: string) => void
  workspaceFolder: string | undefined
  onMoveItemToGroup: (itemId: string, targetGroupId: string, targetIndex?: number) => void
  onSplitItemToEdge: (itemId: string, targetGroupId: string, edge: VscodeSplitEdge) => void
  onOpenMarkdownPreview: (groupId: string) => void
  onTabTextChange: (tabId: string, text: string) => void
  onCursorChange: (line: number, column: number) => void
  onOpenPath: (path: string, reveal?: MonacoRevealPosition) => void
  onResolveConflict: (tabId: string, choice: 'draft' | 'disk') => void
  onSetBranchRatio: (branchId: string, ratio: number) => void
}

function pathInWorkspace(workspaceFolder: string | undefined, path: string | undefined): boolean {
  if (!workspaceFolder || !path) return false
  const root = workspaceFolder.replace(/\/+$/, '') || '/'
  return path === root || path.startsWith(`${root}/`)
}

function pathForGroupItem(
  item: VscodeGroupItem,
  tabs: readonly VscodeTab[],
): string | undefined {
  if (item.kind === 'preview') return item.sourcePath
  return tabs.find((tab) => tab.id === item.tabId)?.path
}

function parseDragPayload(event: DragEvent): VscodeEditorDragPayload | undefined {
  const raw = event.dataTransfer?.getData(VSCODE_EDITOR_DRAG_MIME)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as VscodeEditorDragPayload
      if (typeof parsed.itemId === 'string' && typeof parsed.fromGroupId === 'string') {
        return parsed
      }
    } catch {
      // ignore
    }
  }
  return getActiveEditorDrag()
}

function isEditorTabDrag(event: DragEvent): boolean {
  if (getActiveEditorDrag()) return true
  return [...(event.dataTransfer?.types ?? [])].includes(VSCODE_EDITOR_DRAG_MIME)
}

function dropZoneFromPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): VscodeSplitEdge | undefined {
  const x = (clientX - rect.left) / rect.width
  const y = (clientY - rect.top) / rect.height
  const edge = 0.22
  if (x < edge) return 'left'
  if (x > 1 - edge) return 'right'
  if (y < edge) return 'top'
  if (y > 1 - edge) return 'bottom'
  return undefined
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5C4.5 2.5 1.7 4.8.5 8c1.2 3.2 4 5.5 7.5 5.5s6.3-2.3 7.5-5.5C14.3 4.8 11.5 2.5 8 2.5ZM8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
    </svg>
  )
}

type GroupViewProps = Omit<
  VscodeEditorAreaProps,
  'layout' | 'onSetBranchRatio' | 'onOpenMarkdownPreview'
> & {
  group: VscodeEditorGroupState
  focused: boolean
  onOpenMarkdownPreview: (groupId: string) => void
}

function VscodeEditorGroupView({
  group,
  focused,
  tabs,
  loading,
  dialogBlocked,
  isActiveWindow,
  prefs,
  revealPosition,
  onRevealPositionApplied,
  onFocusGroup,
  onActivateItem,
  onCloseFileTab,
  onClosePreview,
  onCloseOtherInGroup,
  onRevealInExplorer,
  onOpenInFiles,
  workspaceFolder,
  onMoveItemToGroup,
  onSplitItemToEdge,
  onOpenMarkdownPreview,
  onTabTextChange,
  onCursorChange,
  onOpenPath,
  onResolveConflict,
}: GroupViewProps) {
  const { showIconContextMenu } = useIconContextMenu()
  const [dropZone, setDropZone] = useState<DropZone | undefined>(undefined)
  const [tabBarHot, setTabBarHot] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tabsRowRef = useRef<HTMLDivElement>(null)

  const activeItem = getGroupActiveItem(group)
  const activeFileTab =
    activeItem?.kind === 'file'
      ? tabs.find((tab) => tab.id === activeItem.tabId)
      : undefined
  const previewSourceTab =
    activeItem?.kind === 'preview'
      ? tabs.find((tab) => tab.path === activeItem.sourcePath)
      : undefined

  const showPreviewAction = activeFileTab?.language === 'markdown'

  const openTabContextMenu = useCallback(
    (event: MouseEvent, item: VscodeGroupItem) => {
      event.preventDefault()
      event.stopPropagation()
      onFocusGroup(group.id)
      onActivateItem(group.id, item.id)
      const otherCount = group.items.filter((entry) => entry.id !== item.id).length
      const itemPath = pathForGroupItem(item, tabs)
      const canReveal = pathInWorkspace(workspaceFolder, itemPath)
      const canOpenInFiles = itemPath !== undefined && parseFilesAbsolutePath(itemPath) !== undefined
      const copyToClipboard = (text: string) => {
        void navigator.clipboard.writeText(text).catch(() => {
          // clipboard unavailable
        })
      }
      showIconContextMenu(event, [
        {
          type: 'action',
          label: '关闭',
          disabled: loading || dialogBlocked,
          onClick: () => {
            if (item.kind === 'file') onCloseFileTab(item.tabId)
            else onClosePreview(item.id)
          },
        },
        {
          type: 'action',
          label: '关闭其他',
          disabled: loading || dialogBlocked || otherCount === 0,
          onClick: () => onCloseOtherInGroup(group.id, item.id),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '复制路径',
          disabled: !itemPath,
          onClick: () => {
            if (itemPath) copyToClipboard(itemPath)
          },
        },
        {
          type: 'action',
          label: '复制相对路径',
          disabled: !canReveal || !itemPath || !workspaceFolder,
          onClick: () => {
            if (!itemPath || !workspaceFolder) return
            copyToClipboard(relativeToWorkspace(workspaceFolder, itemPath))
          },
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '在工作区列表显示',
          disabled: !canReveal,
          onClick: () => {
            if (itemPath) onRevealInExplorer(itemPath)
          },
        },
        {
          type: 'action',
          label: '在文件中显示',
          disabled: !canOpenInFiles,
          onClick: () => {
            if (itemPath) onOpenInFiles(itemPath)
          },
        },
      ])
    },
    [
      dialogBlocked,
      group,
      loading,
      onActivateItem,
      onCloseFileTab,
      onCloseOtherInGroup,
      onClosePreview,
      onFocusGroup,
      onOpenInFiles,
      onRevealInExplorer,
      showIconContextMenu,
      tabs,
      workspaceFolder,
    ],
  )

  const clearDropZone = useCallback(() => setDropZone(undefined), [])

  useEffect(() => {
    const clearDragVisuals = () => {
      setTabBarHot(false)
      setDropZone(undefined)
      setActiveEditorDrag(undefined)
    }
    window.addEventListener('dragend', clearDragVisuals)
    return () => {
      window.removeEventListener('dragend', clearDragVisuals)
    }
  }, [])

  const onDragOverBody = useCallback(
    (event: DragEvent) => {
      if (!isEditorTabDrag(event)) return
      // 必须拦截，否则 Monaco 会把拖拽内容当正文插入
      event.preventDefault()
      event.stopPropagation()
      setTabBarHot(false)

      const drag = getActiveEditorDrag()
      const rect = bodyRef.current?.getBoundingClientRect()
      if (!rect) {
        event.dataTransfer!.dropEffect = 'none'
        setDropZone(undefined)
        return
      }

      const zone = dropZoneFromPoint(event.clientX, event.clientY, rect)
      const pointlessSelf =
        !!drag && drag.fromGroupId === group.id && group.items.length <= 1
      if (!zone || pointlessSelf) {
        event.dataTransfer!.dropEffect = 'none'
        setDropZone(undefined)
        return
      }

      event.dataTransfer!.dropEffect = 'move'
      setDropZone(zone)
    },
    [group.id, group.items.length],
  )

  const onDropBody = useCallback(
    (event: DragEvent) => {
      if (!isEditorTabDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      const payload = parseDragPayload(event)
      const rect = bodyRef.current?.getBoundingClientRect()
      clearDropZone()
      setTabBarHot(false)
      if (!payload || !rect) return
      if (payload.fromGroupId === group.id && group.items.length <= 1) return
      const zone = dropZoneFromPoint(event.clientX, event.clientY, rect)
      if (!zone) return
      onSplitItemToEdge(payload.itemId, group.id, zone)
    },
    [clearDropZone, group.id, group.items.length, onSplitItemToEdge],
  )

  const onDragOverTabBar = useCallback(
    (event: DragEvent) => {
      if (!isEditorTabDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      clearDropZone()
      const drag = getActiveEditorDrag()
      if (!drag || drag.fromGroupId === group.id) {
        event.dataTransfer!.dropEffect = 'none'
        setTabBarHot(false)
        return
      }
      event.dataTransfer!.dropEffect = 'move'
      setTabBarHot(true)
    },
    [clearDropZone, group.id],
  )

  const onDragLeaveTabBar = useCallback((event: DragEvent) => {
    const current = tabsRowRef.current
    const related = event.relatedTarget
    if (current && related instanceof Node && current.contains(related)) return
    setTabBarHot(false)
  }, [])

  const onDropTabBar = useCallback(
    (event: DragEvent) => {
      if (!isEditorTabDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      setTabBarHot(false)
      clearDropZone()
      const payload = parseDragPayload(event)
      if (!payload || payload.fromGroupId === group.id) return
      onMoveItemToGroup(payload.itemId, group.id)
    },
    [clearDropZone, group.id, onMoveItemToGroup],
  )

  return (
    <div
      class={`vscode__editor-group${focused ? ' vscode__editor-group--focused' : ''}`}
      onMouseDown={() => onFocusGroup(group.id)}
    >
      <div
        ref={tabsRowRef}
        class={`vscode__tabs-row${tabBarHot ? ' vscode__tabs-row--drop-target' : ''}`}
        onDragOver={onDragOverTabBar}
        onDragLeave={onDragLeaveTabBar}
        onDrop={onDropTabBar}
      >
        <div class="vscode__tabs" role="tablist" aria-label="编辑器标签">
          {group.items.map((item) => (
            <EditorTabChip
              key={item.id}
              item={item}
              groupId={group.id}
              active={item.id === activeItem?.id}
              tabs={tabs}
              disabled={loading || dialogBlocked}
              onActivate={() => onActivateItem(group.id, item.id)}
              onClose={() => {
                if (item.kind === 'file') onCloseFileTab(item.tabId)
                else onClosePreview(item.id)
              }}
              onContextMenu={(event) => openTabContextMenu(event, item)}
            />
          ))}
        </div>
        {showPreviewAction ? (
          <div class="vscode__tab-actions">
            <button
              type="button"
              class="vscode__tab-action"
              title="在侧边打开预览"
              aria-label="在侧边打开预览"
              disabled={loading || dialogBlocked}
              onClick={() => onOpenMarkdownPreview(group.id)}
            >
              <EyeIcon />
            </button>
          </div>
        ) : undefined}
      </div>

      <div
        ref={bodyRef}
        class="vscode__editor vscode__editor--drop-target"
        onDragOverCapture={onDragOverBody}
        onDragLeave={clearDropZone}
        onDropCapture={onDropBody}
      >
        {dropZone ? (
          <div
            class={`vscode__drop-zone vscode__drop-zone--${dropZone}`}
            aria-hidden="true"
          />
        ) : undefined}

        {activeItem?.kind === 'preview' ? (
          <div class="vscode__preview-body">
            <VscodeMarkdownPreview text={previewSourceTab?.text ?? ''} />
          </div>
        ) : activeFileTab ? (
          <>
            {activeFileTab.conflict ? (
              <div class="vscode__conflict-banner" role="alertdialog" aria-label="内容冲突">
                <p class="vscode__conflict-banner-text">
                  未保存内容与磁盘上的文件不一致。当前编辑器显示的是未保存版本。
                </p>
                <div class="vscode__conflict-banner-actions">
                  <button
                    type="button"
                    class="vscode__conflict-banner-btn vscode__conflict-banner-btn--primary"
                    onClick={() => onResolveConflict(activeFileTab.id, 'draft')}
                  >
                    保留未保存的内容
                  </button>
                  <button
                    type="button"
                    class="vscode__conflict-banner-btn"
                    onClick={() => onResolveConflict(activeFileTab.id, 'disk')}
                  >
                    使用磁盘上的内容
                  </button>
                </div>
              </div>
            ) : activeFileTab.deleted ? (
              <div class="vscode__deleted-banner" role="status">
                此文件已从磁盘删除，保存将重新创建。
              </div>
            ) : undefined}
            <MonacoEditor
              className="vscode__monaco"
              value={activeFileTab.text}
              onChange={(text) => onTabTextChange(activeFileTab.id, text)}
              language={activeFileTab.language}
              modelPath={activeFileTab.path}
              theme={prefs.theme}
              readOnly={!activeFileTab.writable}
              fontSize={prefs.fontSize}
              minimap={prefs.minimap}
              wordWrap={prefs.wordWrap ? 'on' : 'off'}
              active={isActiveWindow && focused}
              onCursorChange={onCursorChange}
              onOpenPath={onOpenPath}
              revealPosition={
                revealPosition && revealPosition.path === activeFileTab.path
                  ? { line: revealPosition.line, column: revealPosition.column }
                  : undefined
              }
              onRevealPositionApplied={onRevealPositionApplied}
            />
          </>
        ) : (
          <div class="vscode__group-empty">将标签拖到此处</div>
        )}
      </div>
    </div>
  )
}

type TabChipProps = {
  item: VscodeGroupItem
  groupId: string
  active: boolean
  tabs: readonly VscodeTab[]
  disabled: boolean
  onActivate: () => void
  onClose: () => void
  onContextMenu: (event: MouseEvent) => void
}

function EditorTabChip({
  item,
  groupId,
  active,
  tabs,
  disabled,
  onActivate,
  onClose,
  onContextMenu,
}: TabChipProps) {
  const tabRef = useRef<HTMLDivElement>(null)
  const fileTab = item.kind === 'file' ? tabs.find((tab) => tab.id === item.tabId) : undefined
  const previewSource =
    item.kind === 'preview' ? tabs.find((tab) => tab.path === item.sourcePath) : undefined

  const title =
    item.kind === 'preview'
      ? `Preview ${previewSource?.name ?? 'Markdown'}`
      : fileTab
        ? fileTab.deleted
          ? `${fileTab.name}（已删除）`
          : fileTab.conflict
            ? `${fileTab.name}（冲突）`
            : fileTab.name
        : '未知文件'

  const dirty = fileTab ? isVscodeTabDirty(fileTab) : false
  const pathTitle =
    item.kind === 'preview'
      ? previewSource?.path ?? item.sourcePath
      : fileTab?.path ?? ''

  useEffect(() => {
    if (!active) return
    const frame = window.requestAnimationFrame(() => {
      tabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active])

  return (
    <div
      ref={tabRef}
      class={`vscode__tab${active ? ' vscode__tab--active' : ''}${dirty ? ' vscode__tab--dirty' : ''}${fileTab?.deleted ? ' vscode__tab--deleted' : ''}${fileTab?.conflict ? ' vscode__tab--conflict' : ''}`}
      role="tab"
      aria-selected={active}
      draggable
      onContextMenu={onContextMenu}
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest('.vscode__tab-close')) {
          event.preventDefault()
          return
        }
        const payload: VscodeEditorDragPayload = { itemId: item.id, fromGroupId: groupId }
        setActiveEditorDrag(payload)
        event.dataTransfer?.setData(VSCODE_EDITOR_DRAG_MIME, JSON.stringify(payload))
        event.dataTransfer!.effectAllowed = 'move'
      }}
      onDragEnd={() => {
        setActiveEditorDrag(undefined)
      }}
    >
      <button type="button" class="vscode__tab-main" title={pathTitle} onClick={onActivate}>
        {dirty ? <span class="vscode__tab-dot" aria-hidden="true" /> : undefined}
        <span class="vscode__tab-title">{title}</span>
      </button>
      <button
        type="button"
        class="vscode__tab-close"
        aria-label={`关闭 ${title}`}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
      >
        ×
      </button>
    </div>
  )
}

type LayoutNodeViewProps = VscodeEditorAreaProps & {
  node: VscodeLayoutNode
}

function LayoutNodeView({ node, ...props }: LayoutNodeViewProps) {
  if (node.type === 'leaf') {
    const group = props.layout.groups[node.groupId]
    if (!group) return undefined
    return (
      <VscodeEditorGroupView
        {...props}
        group={group}
        focused={props.layout.focusedGroupId === group.id}
      />
    )
  }

  const flexDirection = node.direction === 'horizontal' ? 'row' : 'column'
  const firstStyle =
    node.direction === 'horizontal'
      ? { width: `${node.ratio * 100}%` }
      : { height: `${node.ratio * 100}%` }
  const secondStyle = { flex: '1 1 0' }

  return (
    <div class="vscode__split-branch" style={{ flexDirection }}>
      <div class="vscode__split-child" style={firstStyle}>
        <LayoutNodeView {...props} node={node.children[0]} />
      </div>
      <SplitSash
        direction={node.direction}
        onRatioChange={(ratio) => props.onSetBranchRatio(node.id, ratio)}
        currentRatio={node.ratio}
      />
      <div class="vscode__split-child" style={secondStyle}>
        <LayoutNodeView {...props} node={node.children[1]} />
      </div>
    </div>
  )
}

type SplitSashProps = {
  direction: 'horizontal' | 'vertical'
  currentRatio: number
  onRatioChange: (ratio: number) => void
}

function SplitSash({ direction, currentRatio, onRatioChange }: SplitSashProps) {
  const dragging = useRef(false)

  const onPointerDown = (event: PointerEvent) => {
    const sash = event.currentTarget as HTMLElement
    const parent = sash.parentElement
    if (!parent) return
    dragging.current = true
    sash.setPointerCapture(event.pointerId)
    const rect = parent.getBoundingClientRect()

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragging.current) return
      const ratio =
        direction === 'horizontal'
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height
      onRatioChange(ratio)
    }
    const onUp = (upEvent: PointerEvent) => {
      dragging.current = false
      sash.releasePointerCapture(upEvent.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // keep currentRatio referenced so lint doesn't complain in some configs
    void currentRatio
  }

  return (
    <div
      class={`vscode__split-sash vscode__split-sash--${direction}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
    />
  )
}

export function VscodeEditorArea(props: VscodeEditorAreaProps) {
  if (!props.layout || Object.keys(props.layout.groups).length === 0) {
    return undefined
  }

  return (
    <div class="vscode__editor-fill">
      <LayoutNodeView {...props} node={props.layout.root} />
    </div>
  )
}
