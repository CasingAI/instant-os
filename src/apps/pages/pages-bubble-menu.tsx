import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import {
  PAGES_IMAGE_WIDTH_PRESETS,
  type PagesImageAlign,
} from './pages-markdown.ts'

export type BubbleMode = 'text' | 'block' | 'image' | 'table'
export type TableCellAlign = 'left' | 'center' | 'right'

export type PagesBubbleMenuProps = {
  editor: Editor
  mode: BubbleMode
  style?: Record<string, string | number>
  /** 用于定位夹紧时测量实际宽度 */
  menuRef?: { current: HTMLDivElement | null }
  onPromptLink: () => void
  onConvertBlock: () => void
  onCopyBlock: () => void
  onDeleteBlock: () => void
  onOpenSheet?: () => void
}

function BubbleBtn({
  label,
  title,
  active,
  onClick,
}: {
  label: string
  title: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      class={`pages-bubble__btn${active ? ' pages-bubble__btn--active' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active ? 'true' : 'false'}
      onMouseDown={(event) => {
        event.preventDefault()
        onClick()
      }}
    >
      {label}
    </button>
  )
}

function findSelectedImageElement(editor: Editor): HTMLImageElement | null {
  const { selection } = editor.state
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') {
    return null
  }
  const dom = editor.view.nodeDOM(selection.from)
  if (!(dom instanceof HTMLElement)) return null
  if (dom instanceof HTMLImageElement) return dom
  const img = dom.querySelector('img')
  return img instanceof HTMLImageElement ? img : null
}

function setImageAlign(editor: Editor, align: PagesImageAlign) {
  editor.chain().focus().updateAttributes('image', { align }).run()
}

function setImageWidth(editor: Editor, width: number) {
  const attrs = editor.getAttributes('image') as {
    width?: number | null
    height?: number | null
  }
  const img = findSelectedImageElement(editor)
  const currentW =
    typeof attrs.width === 'number' && attrs.width > 0
      ? attrs.width
      : img && img.clientWidth > 0
        ? img.clientWidth
        : width
  const currentH =
    typeof attrs.height === 'number' && attrs.height > 0
      ? attrs.height
      : img && img.naturalWidth > 0
        ? Math.round((img.naturalHeight * currentW) / img.naturalWidth)
        : img && img.clientHeight > 0
          ? img.clientHeight
          : null
  const height =
    currentH && currentW > 0 ? Math.max(1, Math.round((currentH * width) / currentW)) : null

  editor
    .chain()
    .focus()
    .updateAttributes('image', height ? { width, height } : { width })
    .run()
}

export function tableHasHeaderRow(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name !== 'table') continue
    const firstRow = node.firstChild
    if (!firstRow) return false
    let hasHeader = false
    firstRow.forEach((cell) => {
      if (cell.type.name === 'tableHeader') hasHeader = true
    })
    return hasHeader
  }
  return false
}

function currentCellAlign(editor: Editor): TableCellAlign | null {
  const { selection } = editor.state
  if (selection instanceof CellSelection) {
    let common: TableCellAlign | null | undefined
    let mixed = false
    selection.forEachCell((node) => {
      const raw = node.attrs.align as string | null | undefined
      const align: TableCellAlign =
        raw === 'center' || raw === 'right' || raw === 'left' ? raw : 'left'
      if (common === undefined) common = align
      else if (common !== align) mixed = true
    })
    if (mixed) return null
    return common ?? 'left'
  }
  const fromHeader = editor.getAttributes('tableHeader').align
  const fromCell = editor.getAttributes('tableCell').align
  const raw = (editor.isActive('tableHeader') ? fromHeader : fromCell) as string | null | undefined
  if (raw === 'center' || raw === 'right' || raw === 'left') return raw
  return 'left'
}

/** 批量设置选中单元格对齐；绕过 setCellAttr 在锚点已是目标值时提前 return 的问题 */
function setCellAlign(editor: Editor, align: TableCellAlign) {
  const { state } = editor
  const { selection } = state
  if (selection instanceof CellSelection) {
    let tr = state.tr
    let changed = false
    selection.forEachCell((node, pos) => {
      if (node.attrs.align === align) return
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, align })
      changed = true
    })
    if (changed) {
      editor.view.dispatch(tr)
      editor.view.focus()
    }
    return
  }
  editor.chain().focus().setCellAttribute('align', align).run()
}

function clearSelectedCells(editor: Editor) {
  const { state } = editor
  const { selection } = state
  if (!(selection instanceof CellSelection)) return
  const paragraph = state.schema.nodes.paragraph
  if (!paragraph) return
  let tr = state.tr
  const cells: { pos: number; size: number }[] = []
  selection.forEachCell((node, pos) => {
    cells.push({ pos, size: node.nodeSize })
  })
  // 从后往前清，避免位置偏移
  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i]!
    const node = tr.doc.nodeAt(cell.pos)
    if (!node) continue
    const from = cell.pos + 1
    const to = cell.pos + node.nodeSize - 1
    tr = tr.replaceWith(from, to, paragraph.create())
  }
  editor.view.dispatch(tr)
  editor.view.focus()
}

export function PagesBubbleMenu({
  editor,
  mode,
  style,
  menuRef,
  onPromptLink,
  onConvertBlock,
  onCopyBlock,
  onDeleteBlock,
  onOpenSheet,
}: PagesBubbleMenuProps) {
  if (mode === 'table') {
    const align = currentCellAlign(editor)
    const hasHeader = tableHasHeaderRow(editor)
    const isCellSel = editor.state.selection instanceof CellSelection
    const canMerge = editor.can().mergeCells()
    const canSplit = editor.can().splitCell()
    return (
      <div ref={menuRef} class="pages-bubble" style={style} role="toolbar" aria-label="表格操作">
        <BubbleBtn
          label="左"
          title="左对齐"
          active={align === 'left'}
          onClick={() => setCellAlign(editor, 'left')}
        />
        <BubbleBtn
          label="中"
          title="居中"
          active={align === 'center'}
          onClick={() => setCellAlign(editor, 'center')}
        />
        <BubbleBtn
          label="右"
          title="右对齐"
          active={align === 'right'}
          onClick={() => setCellAlign(editor, 'right')}
        />
        <span class="pages-bubble__divider" />
        {canMerge ? (
          <BubbleBtn
            label="合并"
            title="合并单元格"
            onClick={() => editor.chain().focus().mergeCells().run()}
          />
        ) : null}
        {canSplit ? (
          <BubbleBtn
            label="拆分"
            title="拆分单元格"
            onClick={() => editor.chain().focus().splitCell().run()}
          />
        ) : null}
        {isCellSel ? (
          <BubbleBtn label="清空" title="清空选中单元格" onClick={() => clearSelectedCells(editor)} />
        ) : null}
        {canMerge || canSplit || isCellSel ? <span class="pages-bubble__divider" /> : null}
        <BubbleBtn
          label={hasHeader ? '取消表头' : '表头'}
          title={hasHeader ? '取消表头行' : '设为表头行'}
          active={hasHeader}
          onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        />
        {onOpenSheet ? (
          <>
            <span class="pages-bubble__divider" />
            <BubbleBtn label="表格视图" title="在表格视图中编辑" onClick={onOpenSheet} />
          </>
        ) : null}
      </div>
    )
  }

  if (mode === 'image') {
    const align = (editor.getAttributes('image').align as PagesImageAlign | undefined) ?? 'left'
    const width = Number(editor.getAttributes('image').width) || 0
    return (
      <div ref={menuRef} class="pages-bubble" style={style} role="toolbar" aria-label="图片操作">
        <BubbleBtn
          label="左"
          title="左对齐"
          active={align === 'left'}
          onClick={() => setImageAlign(editor, 'left')}
        />
        <BubbleBtn
          label="中"
          title="居中"
          active={align === 'center'}
          onClick={() => setImageAlign(editor, 'center')}
        />
        <BubbleBtn
          label="右"
          title="右对齐"
          active={align === 'right'}
          onClick={() => setImageAlign(editor, 'right')}
        />
        <span class="pages-bubble__divider" />
        {PAGES_IMAGE_WIDTH_PRESETS.map((preset) => (
          <BubbleBtn
            key={preset.width}
            label={preset.label}
            title={preset.title}
            active={width > 0 && Math.abs(width - preset.width) < 8}
            onClick={() => setImageWidth(editor, preset.width)}
          />
        ))}
        <span class="pages-bubble__divider" />
        <BubbleBtn label="复制" title="复制图片" onClick={onCopyBlock} />
        <BubbleBtn label="删除" title="删除图片" onClick={onDeleteBlock} />
      </div>
    )
  }

  if (mode === 'block') {
    return (
      <div ref={menuRef} class="pages-bubble" style={style} role="toolbar" aria-label="块操作">
        <BubbleBtn label="复制" title="复制块" onClick={onCopyBlock} />
        <BubbleBtn label="删除" title="删除块" onClick={onDeleteBlock} />
        <span class="pages-bubble__divider" />
        <BubbleBtn label="转成…" title="转换块类型" onClick={onConvertBlock} />
      </div>
    )
  }

  return (
    <div ref={menuRef} class="pages-bubble" style={style} role="toolbar" aria-label="文字格式">
      <BubbleBtn
        label="B"
        title="粗体"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <BubbleBtn
        label="I"
        title="斜体"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <BubbleBtn
        label="U"
        title="下划线"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <BubbleBtn
        label="S"
        title="删除线"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <BubbleBtn
        label="<>"
        title="行内代码"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <BubbleBtn label="🔗" title="链接" active={editor.isActive('link')} onClick={onPromptLink} />
      <span class="pages-bubble__divider" />
      <BubbleBtn
        label="正文"
        title="正文"
        active={editor.isActive('paragraph')}
        onClick={() => editor.chain().focus().setParagraph().run()}
      />
      <BubbleBtn
        label="H1"
        title="标题 1"
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <BubbleBtn
        label="H2"
        title="标题 2"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <BubbleBtn
        label="H3"
        title="标题 3"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
    </div>
  )
}
