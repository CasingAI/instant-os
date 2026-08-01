import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { Editor, type JSONContent } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { createPagesExtensions, PAGES_IMAGE_DEFAULT_WIDTH } from './pages-markdown.ts'
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
import { PagesSheetView } from './pages-sheet-view.tsx'
import {
  createTableId,
  findTablePosById,
  promoteEqualsTextToFormulas,
  recalculateAllTablesInEditor,
  replaceTableAtPos,
} from './pages-table-formula.ts'
import {
  clipboardLooksLikeTsvTable,
  promotePastedTableHeaderHtml,
  tsvToTableHtml,
} from './pages-table-paste.ts'

export type PagesViewMode = 'edit' | 'source' | 'sheet'
export type PagesEditorFormat = 'pages' | 'markdown'

export type PagesEditorProps = {
  /** 初始文档（blob URL 已由父级应用）；切换标签时请用 key 强制重挂载 */
  initialDocument: JSONContent
  format: PagesEditorFormat
  editable: boolean
  viewMode: PagesViewMode
  /** sheet 模式下聚焦的表 id */
  sheetTableId?: string | null
  outlineOpen: boolean
  onDocumentChange: (doc: JSONContent) => void
  onViewModeChange: (mode: PagesViewMode) => void
  onEnterSheet?: (tableId: string) => void
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
  /** center：相对 left 水平居中；start：贴选区左侧 */
  align: 'center' | 'start'
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

function selectionCoords(editor: Editor, allowEmptyCaret = false): DOMRect | null {
  const { view, state } = editor
  const { from, to, empty } = state.selection

  if (state.selection instanceof CellSelection) {
    let minTop = Infinity
    let minLeft = Infinity
    let maxBottom = -Infinity
    let maxRight = -Infinity
    state.selection.forEachCell((_node, pos) => {
      const dom = view.nodeDOM(pos)
      if (!(dom instanceof HTMLElement)) return
      const rect = dom.getBoundingClientRect()
      minTop = Math.min(minTop, rect.top)
      minLeft = Math.min(minLeft, rect.left)
      maxBottom = Math.max(maxBottom, rect.bottom)
      maxRight = Math.max(maxRight, rect.right)
    })
    if (minTop < Infinity) {
      return new DOMRect(minLeft, minTop, Math.max(1, maxRight - minLeft), Math.max(1, maxBottom - minTop))
    }
  }

  if (empty && !(state.selection instanceof NodeSelection)) {
    if (!allowEmptyCaret) return null
    try {
      const caret = view.coordsAtPos(from)
      return new DOMRect(
        caret.left,
        caret.top,
        Math.max(1, caret.right - caret.left),
        Math.max(1, caret.bottom - caret.top),
      )
    } catch {
      return null
    }
  }

  if (state.selection instanceof NodeSelection) {
    const dom = view.nodeDOM(state.selection.from)
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect()
      // 个别节点（未完成布局的 img）可能短暂给出 0 宽，回退到父级测量
      if (rect.width < 1 || rect.height < 1) {
        const parent = dom.parentElement
        if (parent) return parent.getBoundingClientRect()
      }
      return rect
    }
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

function loadImageNaturalSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      resolve({
        width: Math.max(1, img.naturalWidth || 1),
        height: Math.max(1, img.naturalHeight || 1),
      })
    }
    img.onerror = () => reject(new Error('image-load-failed'))
    img.src = src
  })
}

function fitImageDisplaySize(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth = PAGES_IMAGE_DEFAULT_WIDTH,
): { width: number; height: number } {
  const width = Math.min(naturalWidth, maxWidth)
  const height = Math.max(1, Math.round((naturalHeight * width) / naturalWidth))
  return { width, height }
}

export function PagesEditor({
  initialDocument,
  format: _format,
  editable,
  viewMode,
  sheetTableId = null,
  outlineOpen,
  onDocumentChange,
  onViewModeChange,
  onEnterSheet,
  registerImage,
  onPromptLink,
  onEditorReady,
}: PagesEditorProps) {
  void _format

  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
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
  const suppressFormulaRecalcRef = useRef(false)
  const formulaRecalcTimerRef = useRef<number | null>(null)

  /** 跳过紧随其后的 onUpdate 上报；若该次 update 未触发则 microtask 清掉，避免吞掉用户下一次编辑 */
  const suppressNextDocumentEmit = useCallback(() => {
    suppressNextUpdateRef.current = true
    queueMicrotask(() => {
      suppressNextUpdateRef.current = false
    })
  }, [])
  const viewModeRef = useRef(viewMode)
  const prevViewModeRef = useRef(viewMode)
  const editableRef = useRef(editable)
  const sourceDraftRef = useRef(jsonContentToMarkdown(initialDocument))
  const pendingDragRef = useRef<PendingDrag | null>(null)
  const dragSessionRef = useRef<BlockDragSession | null>(null)
  const insertFilteredRef = useRef<BlockInsertItem[] | null>(null)
  const [sheetTableJSON, setSheetTableJSON] = useState<JSONContent | null>(null)

  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null)
  const [insertPanel, setInsertPanel] = useState<InsertPanelState | null>(null)
  const [hoverBlock, setHoverBlock] = useState<HoverBlockState | null>(null)
  const hoverBlockRef = useRef<HoverBlockState | null>(null)
  const [targetHighlight, setTargetHighlight] = useState<TargetHighlightState | null>(null)
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const bubbleElRef = useRef<HTMLDivElement | null>(null)
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
    const isCellSel = selection instanceof CellSelection
    const inTable = editor.isActive('table') || isCellSel
    const isTableNode = isNode && selection.node.type.name === 'table'
    // 表内空光标 / 多单元格选区显示表格气泡；其它空选区不显示
    if (selection.empty && !isNode && !inTable) {
      setBubble(null)
      return
    }
    const rect = selectionCoords(editor, inTable && selection.empty && !isCellSel)
    if (!rect) {
      setBubble(null)
      return
    }
    const root = mainRef.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    // 选区滚出主编辑区则隐藏气泡
    if (
      rect.bottom < rootRect.top + 8 ||
      rect.top > rootRect.bottom - 8 ||
      rect.right < rootRect.left + 8 ||
      rect.left > rootRect.right - 8
    ) {
      setBubble(null)
      return
    }
    const isImage = isNode && selection.node.type.name === 'image'
    const mode: BubbleMode = isImage
      ? 'image'
      : isCellSel || isTableNode || (inTable && selection.empty)
        ? 'table'
        : isNode
          ? 'block'
          : 'text'
    const pad = 8
    // 预估全宽（实测校正见下方 effect）；文字条含「正文/H1…」远宽于旧 halfW=140
    const estW = mode === 'image' ? 340 : mode === 'table' ? 380 : mode === 'block' ? 200 : 420
    const rawTop = rect.top - rootRect.top - 40
    const top = Math.min(Math.max(pad, rawTop), Math.max(pad, rootRect.height - 40))
    let left: number
    let align: BubbleState['align']
    if (isNode || isCellSel || mode === 'table') {
      align = 'start'
      left = rect.left - rootRect.left + 12
    } else {
      align = 'center'
      left = rect.left - rootRect.left + rect.width / 2
    }
    if (estW >= rootRect.width - pad * 2) {
      align = 'start'
      left = pad
    } else if (align === 'center') {
      const halfW = estW / 2
      left = Math.min(Math.max(left, halfW + pad), rootRect.width - halfW - pad)
    } else {
      left = Math.min(Math.max(left, pad), rootRect.width - estW - pad)
    }
    setBubble({
      mode,
      top,
      left,
      align,
      blockPos: isNode ? selection.from : null,
    })
  }, [])

  // 按气泡实际宽度再夹紧一次，避免预估偏小导致溢出编辑区
  useEffect(() => {
    if (!bubble) return
    const el = bubbleElRef.current
    const root = mainRef.current
    if (!el || !root) return
    const pad = 8
    const rootW = root.clientWidth
    const bubbleW = el.offsetWidth
    if (bubbleW <= 0) return

    let nextLeft = bubble.left
    let nextAlign = bubble.align
    if (bubbleW >= rootW - pad * 2) {
      nextAlign = 'start'
      nextLeft = pad
    } else if (nextAlign === 'center') {
      const half = bubbleW / 2
      nextLeft = Math.min(Math.max(nextLeft, half + pad), rootW - half - pad)
    } else {
      nextLeft = Math.min(Math.max(nextLeft, pad), rootW - bubbleW - pad)
    }

    if (Math.abs(nextLeft - bubble.left) > 0.5 || nextAlign !== bubble.align) {
      setBubble({ ...bubble, left: nextLeft, align: nextAlign })
    }
  }, [bubble])

  const syncFloatingToScroll = useCallback(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return

    refreshBubble(editor)

    // 滚动时关掉右键（坐标相对点击瞬间，难可靠跟随）
    setContextMenu(null)

    const hover = hoverBlockRef.current
    if (hover) {
      const measured = measureControlsForBlock(editor, hover.blockPos)
      if (measured) {
        setHoverBlockSafe({ blockPos: hover.blockPos, ...measured })
      }
    }

    const insert = insertPanelRef.current
    if (insert) {
      const highlight = measureBlockHighlight(editor, insert.blockPos)
      if (highlight) setTargetHighlight(highlight)
      const controls = measureControlsForBlock(editor, insert.blockPos)
      if (controls) {
        updateInsertPanel({
          ...insert,
          controls,
          rect: { top: controls.top + 26, left: controls.left },
        })
      }
    }

    const slash = slashMenuRef.current
    if (slash?.rect) {
      const nextRect = (() => {
        try {
          // 斜杠仍尽量用当前选区坐标
          const selRect = selectionCoords(editor)
          return selRect
        } catch {
          return null
        }
      })()
      if (nextRect) {
        updateSlashMenu({ ...slash, rect: nextRect })
      }
    }
  }, [measureBlockHighlight, measureControlsForBlock, refreshBubble])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onScroll = () => {
      syncFloatingToScroll()
    }
    stage.addEventListener('scroll', onScroll, { passive: true })
    return () => stage.removeEventListener('scroll', onScroll)
  }, [syncFloatingToScroll, viewMode])

  const insertImageFile = useCallback(async (file: File) => {
    const editor = editorRef.current
    const register = registerImageRef.current
    if (!editor || editor.isDestroyed || !register) return
    try {
      const src = await register(file)
      let width = PAGES_IMAGE_DEFAULT_WIDTH
      let height: number | undefined
      try {
        const natural = await loadImageNaturalSize(src)
        const fitted = fitImageDisplaySize(natural.width, natural.height)
        width = fitted.width
        height = fitted.height
      } catch {
        // 测尺寸失败时仍插入默认宽度
      }
      editor
        .chain()
        .focus()
        .setImage({
          src,
          width,
          ...(height != null ? { height } : {}),
        })
        .run()
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
        transformPastedHTML: (html) => promotePastedTableHeaderHtml(html),
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
            let clickInsideSelection = false
            if (selection instanceof CellSelection) {
              selection.forEachCell((node, cellPos) => {
                if (posInfo.pos >= cellPos && posInfo.pos <= cellPos + node.nodeSize) {
                  clickInsideSelection = true
                }
              })
            } else if (!selection.empty) {
              clickInsideSelection =
                posInfo.pos >= selection.from && posInfo.pos <= selection.to
            }
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
            let hasHeaderRow = false
            for (let d = $pos.depth; d > 0; d--) {
              const node = $pos.node(d)
              if (node.type.name !== 'table') continue
              inTable = true
              const firstRow = node.firstChild
              if (firstRow) {
                firstRow.forEach((cell) => {
                  if (cell.type.name === 'tableHeader') hasHeaderRow = true
                })
              }
              break
            }
            if (view.state.selection instanceof CellSelection) inTable = true
            const onLink = editorInstance.isActive('link')
            const onImage =
              editorInstance.isActive('image') || block.node.type.name === 'image'
            const root = mainRef.current
            if (!root) return true
            const rootRect = root.getBoundingClientRect()
            closeFloatingExcept('context')
            const menuW = 180
            const menuH = 300
            const rawLeft = event.clientX - rootRect.left
            const rawTop = event.clientY - rootRect.top
            setContextMenu({
              top: Math.min(Math.max(4, rawTop), Math.max(4, rootRect.height - menuH)),
              left: Math.min(Math.max(4, rawLeft), Math.max(4, rootRect.width - menuW)),
              blockPos: block.pos,
              items: buildContextMenuItems({
                inTable,
                hasHeaderRow,
                canMergeCells: inTable && editorInstance.can().mergeCells(),
                canSplitCell: inTable && editorInstance.can().splitCell(),
                onLink,
                onImage,
              }),
            })
            return true
          },
          paste: (_view, event) => {
            if (!editableRef.current || viewModeRef.current !== 'edit') return false
            const items = event.clipboardData?.items
            if (items) {
              for (const item of Array.from(items)) {
                if (!item.type.startsWith('image/')) continue
                const file = item.getAsFile()
                if (!file) continue
                event.preventDefault()
                void insertImageFile(file)
                return true
              }
            }

            const html = event.clipboardData?.getData('text/html') ?? ''
            const text = event.clipboardData?.getData('text/plain') ?? ''
            // 纯 TSV（无 HTML 表）时转成带表头的表格，避免落成一堆段落
            if (
              text &&
              clipboardLooksLikeTsvTable(text) &&
              !/<table\b/i.test(html)
            ) {
              const tableHtml = tsvToTableHtml(text)
              const editorInstance = editorRef.current
              if (tableHtml && editorInstance && !editorInstance.isDestroyed) {
                event.preventDefault()
                editorInstance.chain().focus().insertContent(tableHtml).run()
                return true
              }
            }
            return false
          },
          blur: () => {
            if (!editableRef.current || viewModeRef.current !== 'edit') return false
            const ed = editorRef.current
            if (!ed || ed.isDestroyed) return false
            // 失焦后把单元格里以 = 开头的文本提升为公式并重算
            window.setTimeout(() => {
              const current = editorRef.current
              if (!current || current.isDestroyed || viewModeRef.current !== 'edit') return
              if (current.view.hasFocus()) return
              suppressFormulaRecalcRef.current = true
              try {
                promoteEqualsTextToFormulas(current)
                recalculateAllTablesInEditor(current)
              } finally {
                suppressFormulaRecalcRef.current = false
              }
              const doc = current.getJSON()
              sourceDraftRef.current = jsonContentToMarkdown(doc)
              onDocumentChangeRef.current(doc)
            }, 0)
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
        // 不在此处 suppress：若 onCreate 后没有 onUpdate，suppress 会卡住并吞掉用户第一次编辑
        // （例如只改图片对齐），导致画面已变但无法保存。基线由父级首次 onDocumentChange 吸收。
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

        const emitDoc = () => {
          const doc = current.getJSON()
          sourceDraftRef.current = jsonContentToMarkdown(doc)
          onDocumentChangeRef.current(doc)
        }

        if (viewModeRef.current === 'edit' && !suppressFormulaRecalcRef.current) {
          if (formulaRecalcTimerRef.current != null) {
            window.clearTimeout(formulaRecalcTimerRef.current)
          }
          formulaRecalcTimerRef.current = window.setTimeout(() => {
            formulaRecalcTimerRef.current = null
            const ed = editorRef.current
            if (!ed || ed.isDestroyed || viewModeRef.current !== 'edit') return
            if (suppressFormulaRecalcRef.current) return
            suppressFormulaRecalcRef.current = true
            try {
              const changed = recalculateAllTablesInEditor(ed)
              if (!changed) emitDoc()
              // changed 时 nested onUpdate 会 emit
            } finally {
              suppressFormulaRecalcRef.current = false
            }
          }, 350)
        }

        if (suppressFormulaRecalcRef.current) {
          emitDoc()
          return
        }

        emitDoc()
      },
      onSelectionUpdate: ({ editor: current }) => {
        setUiEpoch((value) => value + 1)
        refreshBubble(current)
      },
    })

    editorRef.current = editor

    return () => {
      if (formulaRecalcTimerRef.current != null) {
        window.clearTimeout(formulaRecalcTimerRef.current)
        formulaRecalcTimerRef.current = null
      }
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
    const prev = prevViewModeRef.current
    prevViewModeRef.current = viewMode

    if (viewMode === 'source') {
      const markdown = jsonContentToMarkdown(editor.getJSON())
      sourceDraftRef.current = markdown
      setSourceText(markdown)
      setHoverBlockSafe(null)
      setBubble(null)
      closeFloatingExcept('none')
      updateDragSession(null)
      pendingDragRef.current = null
      setSheetTableJSON(null)
      return
    }

    if (viewMode === 'sheet') {
      setHoverBlockSafe(null)
      setBubble(null)
      closeFloatingExcept('none')
      updateDragSession(null)
      pendingDragRef.current = null
      return
    }

    // edit
    if (prev === 'source') {
      suppressNextDocumentEmit()
      const doc = markdownToJSONContent(sourceDraftRef.current)
      editor.commands.setContent(doc)
      const normalized = editor.getJSON()
      sourceDraftRef.current = jsonContentToMarkdown(normalized)
      onDocumentChange(normalized)
    }

    if (prev === 'sheet') {
      suppressFormulaRecalcRef.current = true
      try {
        recalculateAllTablesInEditor(editor)
      } finally {
        suppressFormulaRecalcRef.current = false
      }
      const doc = editor.getJSON()
      sourceDraftRef.current = jsonContentToMarkdown(doc)
      onDocumentChange(doc)
      setSheetTableJSON(null)
    }
  }, [viewMode, onDocumentChange, closeFloatingExcept, suppressNextDocumentEmit])

  // 进入 sheet：从编辑器取出目标表 JSON
  useEffect(() => {
    if (viewMode !== 'sheet' || !sheetTableId) {
      return
    }
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    const found = findTablePosById(editor, sheetTableId)
    if (!found) {
      onViewModeChange('edit')
      return
    }
    setSheetTableJSON(found.node.toJSON() as JSONContent)
  }, [viewMode, sheetTableId, onViewModeChange])

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

  const openCurrentTableSheet = (editor: Editor) => {
    const { state } = editor
    const $pos = state.doc.resolve(
      Math.min(Math.max(1, state.selection.from), state.doc.content.size),
    )
    let tablePos = -1
    let tableNode = null as ReturnType<typeof state.doc.nodeAt>
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === 'table') {
        tablePos = $pos.before(d)
        tableNode = $pos.node(d)
        break
      }
    }
    if (tablePos < 0 || !tableNode) return
    let tableId = typeof tableNode.attrs.id === 'string' ? tableNode.attrs.id : ''
    if (!tableId) {
      tableId = createTableId()
      editor
        .chain()
        .command(({ tr }) => {
          tr.setNodeMarkup(tablePos, undefined, {
            ...tableNode!.attrs,
            id: tableId,
          })
          return true
        })
        .run()
    }
    const fresh = editor.state.doc.nodeAt(tablePos) ?? tableNode
    setSheetTableJSON(fresh.toJSON() as JSONContent)
    onEnterSheet?.(tableId)
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
      case 'open-sheet':
        openCurrentTableSheet(editor)
        break
      case 'toggle-header-row':
        editor.chain().focus().toggleHeaderRow().run()
        break
      case 'merge-cells':
        editor.chain().focus().mergeCells().run()
        break
      case 'split-cell':
        editor.chain().focus().splitCell().run()
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
        ...(bubble.align === 'center' ? { transform: 'translateX(-50%)' } : {}),
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
    <div
      class={`pages-editor${outlineOpen ? ' pages-editor--with-sidebar' : ''}${
        dragSession ? ' pages-editor--block-dragging' : ''
      }`}
      ref={rootRef}
    >
      <div class="pages-editor__sidebar">
        {outlineOpen && viewMode !== 'sheet' ? (
          <PagesOutline items={outlineItems} onJump={jumpToOutline} />
        ) : null}
      </div>
      <div class="pages-editor__main" ref={mainRef}>
        <div
          ref={stageRef}
          class={`pages-editor__stage${viewMode === 'source' ? ' pages-editor__stage--source' : ''}${
            viewMode === 'sheet' ? ' pages-editor__stage--sheet' : ''
          }`}
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

          {viewMode === 'sheet' && sheetTableJSON ? (
            <PagesSheetView
              key={sheetTableId ?? 'sheet'}
              table={sheetTableJSON}
              editable={editable}
              onBack={() => onViewModeChange('edit')}
              onTableChange={(nextTable) => {
                setSheetTableJSON(nextTable)
                const ed = editorRef.current
                if (!ed || ed.isDestroyed || !sheetTableId) return
                const found = findTablePosById(ed, sheetTableId)
                if (!found) return
                suppressNextDocumentEmit()
                replaceTableAtPos(ed, found.pos, nextTable)
                const doc = ed.getJSON()
                sourceDraftRef.current = jsonContentToMarkdown(doc)
                onDocumentChange(doc)
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
            menuRef={bubbleElRef}
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
              // 图片等 NodeSelection：直接删当前选区，避免块位解析偏差
              if (editor.state.selection instanceof NodeSelection) {
                editor.chain().focus().deleteSelection().run()
                setBubble(null)
                return
              }
              if (bubble.blockPos == null) return
              deleteTopLevelBlock(editor, bubble.blockPos)
              setBubble(null)
            }}
            onOpenSheet={() => {
              openCurrentTableSheet(editor)
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
