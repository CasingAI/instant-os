import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { Editor, type JSONContent } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { createPagesExtensions } from './pages-markdown.ts'
import type { SlashCommandItem } from './pages-slash-commands.ts'
import {
  applyBlockInsert,
  BLOCK_ROW_GUTTER_PX,
  buildBlockInsertCatalog,
  deleteTopLevelBlock,
  findTopLevelBlock,
  findTopLevelBlockAtPoint,
  selectBlockNode,
  type BlockInsertItem,
} from './pages-block-insert.ts'
import {
  commitBlockReorder,
  startBlockDrag,
  updateBlockDrag,
  type BlockDragSession,
} from './pages-block-drag.ts'
import {
  copyEditorSelection,
  cutEditorSelection,
  pasteIntoEditor,
} from './pages-clipboard.ts'
import { jsonContentToMarkdown, markdownToJSONContent } from './pages-doc-convert.ts'
import { PagesInsertPanel } from './pages-insert-panel.tsx'
import { PagesBlockControls } from './pages-block-controls.tsx'
import { PagesBubbleMenu, type BubbleMode } from './pages-bubble-menu.tsx'
import {
  PagesContextMenu,
  buildContextMenuItems,
  type ContextMenuItem,
} from './pages-context-menu.tsx'
import { collectOutlineItems, PagesOutline } from './pages-outline.tsx'

export type PagesViewMode = 'edit' | 'source'
export type PagesEditorFormat = 'pages' | 'markdown'

export type PagesEditorProps = {
  /** 初始文档（blob URL 已由父级应用）；切换标签时请用 key 强制重挂载 */
  initialDocument: JSONContent
  format: PagesEditorFormat
  editable: boolean
  viewMode: PagesViewMode
  outlineOpen: boolean
  onDocumentChange: (doc: JSONContent) => void
  onViewModeChange: (mode: PagesViewMode) => void
  /** 注册图片资源并返回可显示的 blob URL */
  registerImage?: (file: File) => Promise<string>
  onPromptLink: () => Promise<string | undefined>
  onEditorReady?: (editor: Editor | null) => void
}

type SlashMenuState = {
  items: SlashCommandItem[]
  selectedIndex: number
  rect: DOMRect | null
  command: (item: SlashCommandItem) => void
}

type InsertPanelState = {
  items: BlockInsertItem[]
  selectedIndex: number
  rect: { top: number; left: number }
  blockPos: number
  mode: 'replace-or-below' | 'above' | 'below' | 'convert'
  /** 打开时锁定的行侧控件位置（菜单锚在加号下） */
  controls: { top: number; left: number; height: number } | null
}

type HoverBlockState = {
  blockPos: number
  top: number
  left: number
  height: number
}

type TargetHighlightState = {
  top: number
  left: number
  width: number
  height: number
}

type BubbleState = {
  mode: BubbleMode
  top: number
  left: number
  blockPos: number | null
}

type ContextMenuState = {
  top: number
  left: number
  blockPos: number
  items: ContextMenuItem[]
}

type PendingDrag = {
  blockPos: number
  startX: number
  startY: number
  started: boolean
}

type PagesEditorHost = Editor & {
  __pagesInsertImage?: () => void
  __pagesPasteImage?: (file: File) => void
}

function selectionCoords(editor: Editor): DOMRect | null {
  const { view, state } = editor
  const { from, to, empty } = state.selection
  if (empty && !(state.selection instanceof NodeSelection)) return null

  if (state.selection instanceof NodeSelection) {
    const dom = view.nodeDOM(state.selection.from)
    if (dom instanceof HTMLElement) return dom.getBoundingClientRect()
    return null
  }

  try {
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)
    const top = Math.min(start.top, end.top)
    const bottom = Math.max(start.bottom, end.bottom)
    const left = Math.min(start.left, end.left)
    const right = Math.max(start.right, end.right)
    return new DOMRect(left, top, right - left, bottom - top)
  } catch {
    return null
  }
}

export function PagesEditor({
  initialDocument,
  format: _format,
  editable,
  viewMode,
  outlineOpen,
  onDocumentChange,
  onViewModeChange: _onViewModeChange,
  registerImage,
  onPromptLink,
  onEditorReady,
}: PagesEditorProps) {
  void _format
  void _onViewModeChange

  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const slashMenuRef = useRef<SlashMenuState | null>(null)
  const insertPanelRef = useRef<InsertPanelState | null>(null)
  const onDocumentChangeRef = useRef(onDocumentChange)
  const onEditorReadyRef = useRef(onEditorReady)
  const registerImageRef = useRef(registerImage)
  const onPromptLinkRef = useRef(onPromptLink)
  const suppressNextUpdateRef = useRef(false)
  const viewModeRef = useRef(viewMode)
  const editableRef = useRef(editable)
  const sourceDraftRef = useRef(jsonContentToMarkdown(initialDocument))
  const pendingDragRef = useRef<PendingDrag | null>(null)
  const dragSessionRef = useRef<BlockDragSession | null>(null)
  const insertFilteredRef = useRef<BlockInsertItem[] | null>(null)

  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null)
  const [insertPanel, setInsertPanel] = useState<InsertPanelState | null>(null)
  const [hoverBlock, setHoverBlock] = useState<HoverBlockState | null>(null)
  const hoverBlockRef = useRef<HoverBlockState | null>(null)
  const [targetHighlight, setTargetHighlight] = useState<TargetHighlightState | null>(null)
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [dragSession, setDragSession] = useState<BlockDragSession | null>(null)
  const [uiEpoch, setUiEpoch] = useState(0)
  const [sourceText, setSourceText] = useState(() => jsonContentToMarkdown(initialDocument))

  onDocumentChangeRef.current = onDocumentChange
  onEditorReadyRef.current = onEditorReady
  registerImageRef.current = registerImage
  onPromptLinkRef.current = onPromptLink
  viewModeRef.current = viewMode
  editableRef.current = editable
  hoverBlockRef.current = hoverBlock
  dragSessionRef.current = dragSession

  const setHoverBlockSafe = (next: HoverBlockState | null) => {
    hoverBlockRef.current = next
    setHoverBlock(next)
  }

  const updateSlashMenu = (next: SlashMenuState | null) => {
    slashMenuRef.current = next
    setSlashMenu(next)
    if (!next && !insertPanelRef.current) {
      setTargetHighlight(null)
    }
  }

  const updateInsertPanel = (next: InsertPanelState | null) => {
    insertPanelRef.current = next
    setInsertPanel(next)
    if (next) setBubble(null)
    if (!next) {
      setTargetHighlight(null)
      insertFilteredRef.current = null
    }
  }

  const updateDragSession = (next: BlockDragSession | null) => {
    dragSessionRef.current = next
    setDragSession(next)
  }

  const measureBlockHighlight = useCallback((editor: Editor, blockPos: number) => {
    const root = mainRef.current
    if (!root) return null
    const dom = editor.view.nodeDOM(blockPos)
    if (!(dom instanceof HTMLElement)) return null
    const blockRect = dom.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    return {
      top: blockRect.top - rootRect.top,
      left: blockRect.left - rootRect.left - 8,
      width: Math.max(blockRect.width + 16, 120),
      height: Math.max(blockRect.height, 28),
    }
  }, [])

  const measureControlsForBlock = useCallback((editor: Editor, blockPos: number) => {
    const root = mainRef.current
    if (!root) return null
    const dom = editor.view.nodeDOM(blockPos)
    if (!(dom instanceof HTMLElement)) return null
    const blockRect = dom.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    return {
      top: blockRect.top - rootRect.top,
      left: Math.max(0, blockRect.left - rootRect.left - BLOCK_ROW_GUTTER_PX),
      height: Math.max(blockRect.height, 28),
    }
  }, [])

  const closeFloatingExcept = useCallback((keep?: 'slash' | 'insert' | 'context' | 'none') => {
    if (keep !== 'slash') updateSlashMenu(null)
    if (keep !== 'insert') updateInsertPanel(null)
    if (keep !== 'context') setContextMenu(null)
  }, [])

  const refreshBubble = useCallback((editor: Editor) => {
    if (!editableRef.current || viewModeRef.current !== 'edit') {
      setBubble(null)
      return
    }
    const { selection } = editor.state
    const isNode = selection instanceof NodeSelection
    if (selection.empty && !isNode) {
      setBubble(null)
      return
    }
    const rect = selectionCoords(editor)
    if (!rect) {
      setBubble(null)
      return
    }
    const root = mainRef.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    let blockPos: number | null = null
    if (isNode) {
      blockPos = selection.from
    }
    setBubble({
      mode: isNode ? 'block' : 'text',
      top: rect.top - rootRect.top - 44,
      left: rect.left - rootRect.left + rect.width / 2,
      blockPos,
    })
  }, [])

  const insertImageFile = useCallback(async (file: File) => {
    const editor = editorRef.current
    const register = registerImageRef.current
    if (!editor || editor.isDestroyed || !register) return
    try {
      const src = await register(file)
      editor.chain().focus().setImage({ src }).run()
    } catch {
      // 父级注册失败时忽略
    }
  }, [])

  useEffect(() => {
    sourceDraftRef.current = jsonContentToMarkdown(initialDocument)
    setSourceText(sourceDraftRef.current)
  }, [initialDocument])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const editor = new Editor({
      element: host,
      editable,
      content: initialDocument,
      extensions: createPagesExtensions({
        items: [],
        onOpen: ({ items, clientRect, command }) => {
          closeFloatingExcept('slash')
          const current = editorRef.current
          if (current && !current.isDestroyed) {
            const block = findTopLevelBlock(current, current.state.selection.from)
            if (block) {
              const highlight = measureBlockHighlight(current, block.pos)
              if (highlight) setTargetHighlight(highlight)
            }
          }
          updateSlashMenu({
            items,
            selectedIndex: 0,
            rect: clientRect?.() ?? null,
            command,
          })
        },
        onUpdate: ({ items, clientRect, command }) => {
          const prev = slashMenuRef.current
          updateSlashMenu({
            items,
            selectedIndex: prev
              ? Math.min(prev.selectedIndex, Math.max(0, items.length - 1))
              : 0,
            rect: clientRect?.() ?? null,
            command,
          })
        },
        onKeyDown: ({ event }) => {
          const prev = slashMenuRef.current
          if (!prev || prev.items.length === 0) return false
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            updateSlashMenu({
              ...prev,
              selectedIndex: (prev.selectedIndex + 1) % prev.items.length,
            })
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            updateSlashMenu({
              ...prev,
              selectedIndex: (prev.selectedIndex - 1 + prev.items.length) % prev.items.length,
            })
            return true
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            const item = prev.items[prev.selectedIndex]
            if (item) prev.command(item)
            return true
          }
          return false
        },
        onClose: () => {
          updateSlashMenu(null)
        },
      }),
      editorProps: {
        attributes: {
          class: 'pages-editor__prose',
          spellcheck: 'false',
        },
        handleDOMEvents: {
          contextmenu: (view, event) => {
            if (!editableRef.current || viewModeRef.current !== 'edit') return false
            event.preventDefault()
            const coords = { left: event.clientX, top: event.clientY }
            const posInfo = view.posAtCoords(coords)
            if (!posInfo) return true
            const editorInstance = editorRef.current
            if (!editorInstance) return true

            const { selection } = view.state
            const clickInsideSelection =
              !selection.empty && posInfo.pos >= selection.from && posInfo.pos <= selection.to
            if (!clickInsideSelection && !(selection instanceof NodeSelection)) {
              try {
                const sel = TextSelection.near(view.state.doc.resolve(posInfo.pos))
                view.dispatch(view.state.tr.setSelection(sel))
              } catch {
                // ignore
              }
            }

            const block = findTopLevelBlock(editorInstance, posInfo.pos)
            if (!block) return true

            const $pos = view.state.doc.resolve(posInfo.pos)
            let inTable = false
            for (let d = $pos.depth; d > 0; d--) {
              if ($pos.node(d).type.name === 'table') {
                inTable = true
                break
              }
            }
            const onLink = editorInstance.isActive('link')
            const onImage =
              editorInstance.isActive('image') || block.node.type.name === 'image'
            const root = mainRef.current
            if (!root) return true
            const rootRect = root.getBoundingClientRect()
            closeFloatingExcept('context')
            setContextMenu({
              top: event.clientY - rootRect.top,
              left: event.clientX - rootRect.left,
              blockPos: block.pos,
              items: buildContextMenuItems({ inTable, onLink, onImage }),
            })
            return true
          },
          paste: (_view, event) => {
            if (!editableRef.current || viewModeRef.current !== 'edit') return false
            const items = event.clipboardData?.items
            if (!items) return false
            for (const item of Array.from(items)) {
              if (!item.type.startsWith('image/')) continue
              const file = item.getAsFile()
              if (!file) continue
              event.preventDefault()
              void insertImageFile(file)
              return true
            }
            return false
          },
        },
      },
      onCreate: ({ editor: created }) => {
        const hostEditor = created as PagesEditorHost
        hostEditor.__pagesInsertImage = () => {
          fileInputRef.current?.click()
        }
        hostEditor.__pagesPasteImage = (file) => {
          void insertImageFile(file)
        }
        suppressNextUpdateRef.current = true
        const markdown = jsonContentToMarkdown(created.getJSON())
        sourceDraftRef.current = markdown
        onDocumentChangeRef.current(created.getJSON())
        onEditorReadyRef.current?.(created)
      },
      onUpdate: ({ editor: current }) => {
        setUiEpoch((value) => value + 1)
        refreshBubble(current)
        if (suppressNextUpdateRef.current) {
          suppressNextUpdateRef.current = false
          return
        }
        if (viewModeRef.current === 'source') return
        const doc = current.getJSON()
        sourceDraftRef.current = jsonContentToMarkdown(doc)
        onDocumentChangeRef.current(doc)
      },
      onSelectionUpdate: ({ editor: current }) => {
        setUiEpoch((value) => value + 1)
        refreshBubble(current)
      },
    })

    editorRef.current = editor

    return () => {
      const hostEditor = editor as PagesEditorHost
      hostEditor.__pagesInsertImage = undefined
      hostEditor.__pagesPasteImage = undefined
      onEditorReadyRef.current?.(null)
      editor.destroy()
      editorRef.current = null
      updateSlashMenu(null)
      updateInsertPanel(null)
      setContextMenu(null)
      setBubble(null)
      updateDragSession(null)
      pendingDragRef.current = null
      setHoverBlockSafe(null)
    }
    // 仅挂载一次；标签切换靠父级 key 重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    if (editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
    if (!editable) {
      setHoverBlockSafe(null)
      setBubble(null)
      closeFloatingExcept('none')
      updateDragSession(null)
      pendingDragRef.current = null
    }
  }, [editable, closeFloatingExcept])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    if (viewMode === 'source') {
      const markdown = jsonContentToMarkdown(editor.getJSON())
      sourceDraftRef.current = markdown
      setSourceText(markdown)
      setHoverBlockSafe(null)
      setBubble(null)
      closeFloatingExcept('none')
      updateDragSession(null)
      pendingDragRef.current = null
      return
    }
    suppressNextUpdateRef.current = true
    const doc = markdownToJSONContent(sourceDraftRef.current)
    editor.commands.setContent(doc)
    const normalized = editor.getJSON()
    sourceDraftRef.current = jsonContentToMarkdown(normalized)
    onDocumentChange(normalized)
  }, [viewMode, onDocumentChange, closeFloatingExcept])

  // 行侧控件：整行（正文 + 左侧 gutter）命中，加号条与行同高
  useEffect(() => {
    const editor = editorRef.current
    const root = mainRef.current
    if (!editor || editor.isDestroyed || !root) return
    if (!editable || viewMode !== 'edit') {
      setHoverBlockSafe(null)
      return
    }

    const onMove = (event: MouseEvent) => {
      if (slashMenuRef.current) return
      if (insertPanelRef.current) return
      if (dragSessionRef.current || pendingDragRef.current?.started) return

      const target = event.target as HTMLElement | null
      // 指针已在行侧条上：保持当前行，只刷新位置
      if (target?.closest('.pages-block-controls')) {
        const prev = hoverBlockRef.current
        if (prev) {
          const measured = measureControlsForBlock(editor, prev.blockPos)
          if (measured) {
            setHoverBlockSafe({ blockPos: prev.blockPos, ...measured })
          }
        }
        return
      }

      const block = findTopLevelBlockAtPoint(editor, event.clientX, event.clientY)
      if (!block) {
        setHoverBlockSafe(null)
        return
      }
      const measured = measureControlsForBlock(editor, block.pos)
      if (!measured) {
        setHoverBlockSafe(null)
        return
      }
      setHoverBlockSafe({
        blockPos: block.pos,
        ...measured,
      })
    }

    const onLeave = (event: MouseEvent) => {
      const related = event.relatedTarget as HTMLElement | null
      if (related?.closest('.pages-block-controls')) return
      if (related && root.contains(related)) return
      if (insertPanelRef.current) return
      if (dragSessionRef.current) return
      setHoverBlockSafe(null)
    }

    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    return () => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
    }
  }, [editable, viewMode, uiEpoch, measureControlsForBlock])

  // 块拖拽：阈值按下后移动超过 4px 才开始
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const pending = pendingDragRef.current
      const editor = editorRef.current
      const root = mainRef.current
      if (!pending || !editor || editor.isDestroyed || !root) return

      const dx = event.clientX - pending.startX
      const dy = event.clientY - pending.startY
      if (!pending.started) {
        if (dx * dx + dy * dy < 16) return
        pending.started = true
        closeFloatingExcept('none')
        setBubble(null)
        const rootRect = root.getBoundingClientRect()
        updateDragSession(
          startBlockDrag(editor, pending.blockPos, event.clientX, event.clientY, rootRect),
        )
        return
      }

      const session = dragSessionRef.current
      if (!session) return
      const rootRect = root.getBoundingClientRect()
      updateDragSession(updateBlockDrag(editor, session, event.clientX, event.clientY, rootRect))
    }

    const onUp = () => {
      const pending = pendingDragRef.current
      const editor = editorRef.current
      pendingDragRef.current = null
      if (!pending) return

      if (!pending.started) {
        if (editor && !editor.isDestroyed) {
          selectBlockNode(editor, pending.blockPos)
          refreshBubble(editor)
        }
        return
      }

      const session = dragSessionRef.current
      updateDragSession(null)
      if (!editor || editor.isDestroyed || !session || session.dropIndex == null) return
      commitBlockReorder(editor, session.fromPos, session.dropIndex)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [closeFloatingExcept, refreshBubble])

  // Escape / 点击外侧关闭浮层；Escape 取消拖拽
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (dragSessionRef.current || pendingDragRef.current?.started) {
        event.preventDefault()
        pendingDragRef.current = null
        updateDragSession(null)
        return
      }
      if (insertPanelRef.current) {
        event.preventDefault()
        updateInsertPanel(null)
        return
      }
      if (contextMenu) {
        event.preventDefault()
        setContextMenu(null)
      }
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (
        target.closest('.pages-insert') ||
        target.closest('.pages-context-menu') ||
        target.closest('.pages-bubble') ||
        target.closest('.pages-block-controls')
      ) {
        return
      }
      updateInsertPanel(null)
      setContextMenu(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [contextMenu])

  // 插入面板键盘导航
  useEffect(() => {
    if (!insertPanel) return
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = insertPanelRef.current
      if (!panel) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const list = insertFilteredRef.current ?? panel.items
        if (list.length === 0) return
        updateInsertPanel({
          ...panel,
          selectedIndex: (panel.selectedIndex + 1) % list.length,
        })
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        const list = insertFilteredRef.current ?? panel.items
        if (list.length === 0) return
        updateInsertPanel({
          ...panel,
          selectedIndex: (panel.selectedIndex - 1 + list.length) % list.length,
        })
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const list = insertFilteredRef.current ?? panel.items
        const item = list[panel.selectedIndex]
        if (item) {
          const editor = editorRef.current
          if (editor && !editor.isDestroyed) {
            applyBlockInsert(editor, panel.blockPos, item, panel.mode)
          }
          updateInsertPanel(null)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [insertPanel])

  const openInsertPanel = (
    blockPos: number,
    mode: InsertPanelState['mode'],
    controls: { top: number; left: number; height: number } | null,
  ) => {
    closeFloatingExcept('insert')
    const editor = editorRef.current
    const highlight = editor && !editor.isDestroyed ? measureBlockHighlight(editor, blockPos) : null
    if (highlight) setTargetHighlight(highlight)

    const resolvedControls =
      controls ??
      (editor && !editor.isDestroyed ? measureControlsForBlock(editor, blockPos) : null)

    const anchor = resolvedControls
      ? { top: resolvedControls.top + 26, left: resolvedControls.left }
      : highlight
        ? { top: highlight.top + highlight.height + 4, left: highlight.left }
        : { top: 48, left: 48 }

    if (resolvedControls) {
      setHoverBlockSafe({ blockPos, ...resolvedControls })
    }

    updateInsertPanel({
      items: buildBlockInsertCatalog(),
      selectedIndex: 0,
      rect: anchor,
      blockPos,
      mode,
      controls: resolvedControls,
    })
  }

  const promptLink = async () => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed || !editable) return
    const next = await onPromptLinkRef.current()
    if (next === undefined) return
    const trimmed = next.trim()
    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
  }

  const handleContextAction = async (id: string) => {
    const editor = editorRef.current
    const menu = contextMenu
    if (!editor || editor.isDestroyed || !menu) return
    const { blockPos } = menu
    setContextMenu(null)

    switch (id) {
      case 'copy':
        if (editor.state.selection.empty) {
          selectBlockNode(editor, blockPos)
        }
        await copyEditorSelection(editor)
        break
      case 'cut':
        if (editor.state.selection.empty) {
          selectBlockNode(editor, blockPos)
        }
        await cutEditorSelection(editor)
        break
      case 'paste':
        await pasteIntoEditor(editor)
        break
      case 'insert-above': {
        const controls =
          hoverBlock?.blockPos === blockPos
            ? hoverBlock
            : editor
              ? measureControlsForBlock(editor, blockPos)
              : null
        openInsertPanel(
          blockPos,
          'above',
          controls
            ? { top: controls.top, left: controls.left, height: controls.height }
            : null,
        )
        break
      }
      case 'insert-below': {
        const controls =
          hoverBlock?.blockPos === blockPos
            ? hoverBlock
            : editor
              ? measureControlsForBlock(editor, blockPos)
              : null
        openInsertPanel(
          blockPos,
          'below',
          controls
            ? { top: controls.top, left: controls.left, height: controls.height }
            : null,
        )
        break
      }
      case 'delete-block':
        deleteTopLevelBlock(editor, blockPos)
        break
      case 'edit-link':
        await promptLink()
        break
      case 'unset-link':
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
        break
      case 'replace-image':
        selectBlockNode(editor, blockPos)
        fileInputRef.current?.click()
        break
      case 'add-row-before':
        editor.chain().focus().addRowBefore().run()
        break
      case 'add-row-after':
        editor.chain().focus().addRowAfter().run()
        break
      case 'add-col-before':
        editor.chain().focus().addColumnBefore().run()
        break
      case 'add-col-after':
        editor.chain().focus().addColumnAfter().run()
        break
      case 'delete-row':
        editor.chain().focus().deleteRow().run()
        break
      case 'delete-col':
        editor.chain().focus().deleteColumn().run()
        break
      default:
        break
    }
  }

  const jumpToOutline = (pos: number) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    try {
      const $pos = editor.state.doc.resolve(Math.min(pos + 1, editor.state.doc.content.size))
      const sel = TextSelection.near($pos)
      editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView())
      editor.view.focus()
    } catch {
      // ignore
    }
  }

  const editor = editorRef.current
  void uiEpoch

  const outlineItems = editor && !editor.isDestroyed ? collectOutlineItems(editor) : []

  const slashStyle = (() => {
    if (!slashMenu?.rect) return undefined
    const root = mainRef.current
    if (!root) {
      return {
        top: `${slashMenu.rect.bottom + 6}px`,
        left: `${slashMenu.rect.left}px`,
      }
    }
    const rootRect = root.getBoundingClientRect()
    return {
      top: `${slashMenu.rect.bottom + 6 - rootRect.top}px`,
      left: `${slashMenu.rect.left - rootRect.left}px`,
    }
  })()

  const insertStyle = insertPanel
    ? {
        top: `${insertPanel.rect.top}px`,
        left: `${insertPanel.rect.left}px`,
      }
    : undefined

  const bubbleStyle = bubble
    ? {
        top: `${Math.max(4, bubble.top)}px`,
        left: `${bubble.left}px`,
        transform: 'translateX(-50%)',
      }
    : undefined

  const contextStyle = contextMenu
    ? {
        top: `${contextMenu.top}px`,
        left: `${contextMenu.left}px`,
      }
    : undefined

  const showControls =
    editable &&
    viewMode === 'edit' &&
    !slashMenu &&
    !contextMenu &&
    !dragSession &&
    (hoverBlock != null || insertPanel?.controls != null)

  const activeControls = insertPanel?.controls
    ? {
        top: insertPanel.controls.top,
        left: insertPanel.controls.left,
        height: insertPanel.controls.height,
        blockPos: insertPanel.blockPos,
      }
    : hoverBlock

  const slashIsFullCatalog =
    !!slashMenu &&
    slashMenu.items.length === buildBlockInsertCatalog().length &&
    slashMenu.items.every((item) => item.section)

  return (
    <div class={`pages-editor${outlineOpen ? ' pages-editor--with-sidebar' : ''}`} ref={rootRef}>
      <div class="pages-editor__sidebar">
        {outlineOpen ? <PagesOutline items={outlineItems} onJump={jumpToOutline} /> : null}
      </div>
      <div class="pages-editor__main" ref={mainRef}>
        <div
          class={`pages-editor__stage${viewMode === 'source' ? ' pages-editor__stage--source' : ''}`}
        >
          <div
            class="pages-editor__canvas"
            style={{ display: viewMode === 'edit' ? undefined : 'none' }}
          >
            <div class="pages-editor__column">
              <div ref={hostRef} class="pages-editor__host" />
            </div>
          </div>

          {viewMode === 'source' ? (
            <textarea
              class="pages-editor__source"
              value={sourceText}
              readOnly={!editable}
              spellcheck={false}
              aria-label="Markdown 源码"
              onInput={(event) => {
                const next = (event.target as HTMLTextAreaElement).value
                setSourceText(next)
                sourceDraftRef.current = next
                onDocumentChange(markdownToJSONContent(next))
              }}
            />
          ) : undefined}
        </div>

        {targetHighlight && (insertPanel || slashMenu) ? (
          <div
            class="pages-insert-target"
            style={{
              top: `${targetHighlight.top}px`,
              left: `${targetHighlight.left}px`,
              width: `${targetHighlight.width}px`,
              height: `${targetHighlight.height}px`,
            }}
          />
        ) : null}

        {showControls && activeControls ? (
          <PagesBlockControls
            top={activeControls.top}
            left={activeControls.left}
            height={activeControls.height}
            plusActive={!!insertPanel}
            onPlus={() => {
              if (insertPanel) {
                updateInsertPanel(null)
                return
              }
              openInsertPanel(activeControls.blockPos, 'replace-or-below', {
                top: activeControls.top,
                left: activeControls.left,
                height: activeControls.height,
              })
            }}
            onHandleMouseDown={(event) => {
              if (!editable || viewMode !== 'edit') return
              pendingDragRef.current = {
                blockPos: activeControls.blockPos,
                startX: event.clientX,
                startY: event.clientY,
                started: false,
              }
            }}
          />
        ) : null}

        {dragSession ? (
          <>
            <div
              class="pages-block-drag-ghost"
              style={{
                top: `${dragSession.ghost.top}px`,
                left: `${dragSession.ghost.left}px`,
                width: `${dragSession.ghost.width}px`,
              }}
            >
              {dragSession.ghost.label}
            </div>
            {dragSession.indicator ? (
              <div
                class="pages-block-drop-indicator"
                style={{
                  top: `${dragSession.indicator.top}px`,
                  left: `${dragSession.indicator.left}px`,
                  width: `${dragSession.indicator.width}px`,
                }}
              />
            ) : null}
          </>
        ) : null}

        {bubble &&
        editor &&
        !editor.isDestroyed &&
        viewMode === 'edit' &&
        editable &&
        !slashMenu &&
        !insertPanel &&
        !contextMenu &&
        !dragSession ? (
          <PagesBubbleMenu
            editor={editor}
            mode={bubble.mode}
            style={bubbleStyle}
            onPromptLink={() => {
              void promptLink()
            }}
            onConvertBlock={() => {
              if (bubble.blockPos == null) return
              const controls = measureControlsForBlock(editor, bubble.blockPos)
              openInsertPanel(bubble.blockPos, 'convert', controls)
            }}
            onCopyBlock={() => {
              void copyEditorSelection(editor)
            }}
            onDeleteBlock={() => {
              if (bubble.blockPos == null) return
              deleteTopLevelBlock(editor, bubble.blockPos)
              setBubble(null)
            }}
          />
        ) : null}

        {slashMenu && viewMode === 'edit' && slashMenu.items.length > 0 ? (
          <PagesInsertPanel
            items={slashMenu.items}
            selectedIndex={slashMenu.selectedIndex}
            style={slashStyle}
            layout={slashIsFullCatalog ? 'dense' : 'flat'}
            onHoverIndex={(index) => {
              const prev = slashMenuRef.current
              if (!prev) return
              updateSlashMenu({ ...prev, selectedIndex: index })
            }}
            onSelect={(item) => {
              const match = slashMenu.items.find((entry) => entry.id === item.id)
              if (match) slashMenu.command(match)
            }}
          />
        ) : null}

        {insertPanel && viewMode === 'edit' ? (
          <PagesInsertPanel
            items={insertPanel.items}
            selectedIndex={insertPanel.selectedIndex}
            style={insertStyle}
            layout="dense"
            enableSearch
            onHoverIndex={(index) => {
              const prev = insertPanelRef.current
              if (!prev) return
              updateInsertPanel({ ...prev, selectedIndex: index })
            }}
            onSelect={(item) => {
              const current = editorRef.current
              if (!current || current.isDestroyed) return
              const catalogItem =
                insertFilteredRef.current?.find((entry) => entry.id === item.id) ??
                insertPanel.items.find((entry) => entry.id === item.id)
              if (!catalogItem) return
              applyBlockInsert(current, insertPanel.blockPos, catalogItem, insertPanel.mode)
              updateInsertPanel(null)
            }}
            onFilteredItemsChange={(items) => {
              const prev = insertPanelRef.current
              if (!prev) return
              const nextItems = items
                .map((item) => {
                  return (
                    prev.items.find((entry) => entry.id === item.id) ??
                    buildBlockInsertCatalog().find((entry) => entry.id === item.id)
                  )
                })
                .filter((entry): entry is BlockInsertItem => entry != null)
              insertFilteredRef.current = nextItems
              const nextIndex = Math.min(prev.selectedIndex, Math.max(0, nextItems.length - 1))
              if (nextIndex !== prev.selectedIndex) {
                updateInsertPanel({ ...prev, selectedIndex: nextIndex })
              }
            }}
          />
        ) : null}

        {contextMenu && viewMode === 'edit' && editable ? (
          <PagesContextMenu
            items={contextMenu.items}
            style={contextStyle}
            onAction={(id) => {
              void handleContextAction(id)
            }}
          />
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          class="pages-editor__file-input"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const input = event.target as HTMLInputElement
            const file = input.files?.[0]
            input.value = ''
            if (file) void insertImageFile(file)
          }}
        />
      </div>
    </div>
  )
}
