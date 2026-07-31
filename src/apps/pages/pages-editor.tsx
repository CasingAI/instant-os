import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { Editor } from '@tiptap/core'
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
import { PagesInsertPanel } from './pages-insert-panel.tsx'
import { PagesBlockControls } from './pages-block-controls.tsx'
import { PagesBubbleMenu, type BubbleMode } from './pages-bubble-menu.tsx'
import {
  PagesContextMenu,
  buildContextMenuItems,
  type ContextMenuItem,
} from './pages-context-menu.tsx'

export type PagesViewMode = 'edit' | 'source'

export type PagesEditorProps = {
  /** 初始 Markdown；切换标签时请用 key 强制重挂载 */
  initialMarkdown: string
  editable: boolean
  viewMode: PagesViewMode
  onMarkdownChange: (markdown: string) => void
  onViewModeChange: (mode: PagesViewMode) => void
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

function readMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } }
  return storage.markdown?.getMarkdown?.() ?? ''
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
  initialMarkdown,
  editable,
  viewMode,
  onMarkdownChange,
  onViewModeChange: _onViewModeChange,
  onEditorReady,
}: PagesEditorProps) {
  void _onViewModeChange

  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const slashMenuRef = useRef<SlashMenuState | null>(null)
  const insertPanelRef = useRef<InsertPanelState | null>(null)
  const onMarkdownChangeRef = useRef(onMarkdownChange)
  const onEditorReadyRef = useRef(onEditorReady)
  const suppressNextUpdateRef = useRef(false)
  const viewModeRef = useRef(viewMode)
  const editableRef = useRef(editable)
  const sourceDraftRef = useRef(initialMarkdown)

  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null)
  const [insertPanel, setInsertPanel] = useState<InsertPanelState | null>(null)
  const [hoverBlock, setHoverBlock] = useState<HoverBlockState | null>(null)
  const hoverBlockRef = useRef<HoverBlockState | null>(null)
  const [targetHighlight, setTargetHighlight] = useState<TargetHighlightState | null>(null)
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [uiEpoch, setUiEpoch] = useState(0)
  const [sourceText, setSourceText] = useState(initialMarkdown)

  onMarkdownChangeRef.current = onMarkdownChange
  onEditorReadyRef.current = onEditorReady
  viewModeRef.current = viewMode
  editableRef.current = editable
  hoverBlockRef.current = hoverBlock

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
    if (!next) setTargetHighlight(null)
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

  useEffect(() => {
    sourceDraftRef.current = initialMarkdown
    setSourceText(initialMarkdown)
  }, [initialMarkdown])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const editor = new Editor({
      element: host,
      editable,
      content: initialMarkdown,
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
            const root = mainRef.current
            if (!root) return true
            const rootRect = root.getBoundingClientRect()
            closeFloatingExcept('context')
            setContextMenu({
              top: event.clientY - rootRect.top,
              left: event.clientX - rootRect.left,
              blockPos: block.pos,
              items: buildContextMenuItems({ inTable, onLink }),
            })
            return true
          },
        },
      },
      onCreate: ({ editor: created }) => {
        suppressNextUpdateRef.current = true
        const markdown = readMarkdown(created)
        sourceDraftRef.current = markdown
        onMarkdownChangeRef.current(markdown)
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
        const markdown = readMarkdown(current)
        sourceDraftRef.current = markdown
        onMarkdownChangeRef.current(markdown)
      },
      onSelectionUpdate: ({ editor: current }) => {
        setUiEpoch((value) => value + 1)
        refreshBubble(current)
      },
    })

    editorRef.current = editor

    return () => {
      onEditorReadyRef.current?.(null)
      editor.destroy()
      editorRef.current = null
      updateSlashMenu(null)
      updateInsertPanel(null)
      setContextMenu(null)
      setBubble(null)
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
    }
  }, [editable, closeFloatingExcept])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    if (viewMode === 'source') {
      const markdown = readMarkdown(editor)
      sourceDraftRef.current = markdown
      setSourceText(markdown)
      setHoverBlockSafe(null)
      setBubble(null)
      closeFloatingExcept('none')
      return
    }
    suppressNextUpdateRef.current = true
    editor.commands.setContent(sourceDraftRef.current)
    const normalized = readMarkdown(editor)
    sourceDraftRef.current = normalized
    onMarkdownChange(normalized)
  }, [viewMode, onMarkdownChange, closeFloatingExcept])

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
      setHoverBlockSafe(null)
    }

    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    return () => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
    }
  }, [editable, viewMode, uiEpoch, measureControlsForBlock])

  // Escape / 点击外侧关闭浮层
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
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
        updateInsertPanel({
          ...panel,
          selectedIndex: (panel.selectedIndex + 1) % panel.items.length,
        })
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        updateInsertPanel({
          ...panel,
          selectedIndex:
            (panel.selectedIndex - 1 + panel.items.length) % panel.items.length,
        })
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const item = panel.items[panel.selectedIndex]
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

  const promptLink = () => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed || !editable) return
    const previous = editor.getAttributes('link').href as string | undefined
    const next = window.prompt('链接地址', previous ?? 'https://')
    if (next === null) return
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
        document.execCommand('copy')
        break
      case 'cut':
        if (editor.state.selection.empty) {
          selectBlockNode(editor, blockPos)
        }
        document.execCommand('cut')
        break
      case 'paste': {
        try {
          const text = await navigator.clipboard.readText()
          editor.chain().focus().insertContent(text).run()
        } catch {
          // 权限不足时忽略
        }
        break
      }
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
        promptLink()
        break
      case 'unset-link':
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
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

  const editor = editorRef.current
  void uiEpoch

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
    <div class="pages-editor" ref={rootRef}>
      <div class="pages-editor__sidebar" aria-hidden="true" />
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
                onMarkdownChange(next)
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
            onHandle={() => {
              const current = editorRef.current
              if (!current || current.isDestroyed) return
              selectBlockNode(current, activeControls.blockPos)
              refreshBubble(current)
            }}
          />
        ) : null}

        {bubble &&
        editor &&
        !editor.isDestroyed &&
        viewMode === 'edit' &&
        editable &&
        !slashMenu &&
        !insertPanel &&
        !contextMenu ? (
          <PagesBubbleMenu
            editor={editor}
            mode={bubble.mode}
            style={bubbleStyle}
            onPromptLink={promptLink}
            onConvertBlock={() => {
              if (bubble.blockPos == null) return
              const controls = measureControlsForBlock(editor, bubble.blockPos)
              openInsertPanel(bubble.blockPos, 'convert', controls)
            }}
            onCopyBlock={() => {
              document.execCommand('copy')
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
            onHoverIndex={(index) => {
              const prev = insertPanelRef.current
              if (!prev) return
              updateInsertPanel({ ...prev, selectedIndex: index })
            }}
            onSelect={(item) => {
              const current = editorRef.current
              if (!current || current.isDestroyed) return
              const catalogItem = insertPanel.items.find((entry) => entry.id === item.id)
              if (!catalogItem) return
              applyBlockInsert(current, insertPanel.blockPos, catalogItem, insertPanel.mode)
              updateInsertPanel(null)
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
      </div>
    </div>
  )
}
