import type { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { createTableId } from './pages-table-formula.ts'

export type BlockInsertSection = 'basic' | 'common'

export type BlockInsertItem = {
  id: string
  title: string
  description: string
  keywords: string[]
  /** 网格/列表里的短图标文案 */
  icon: string
  section: BlockInsertSection
  /** 在当前选区上应用块类型（假定焦点已在目标位置） */
  apply: (editor: Editor) => void
}

export type TopLevelBlock = {
  node: ProseMirrorNode
  /** 块在文档中的绝对位置（节点起点） */
  pos: number
}

export function buildBlockInsertCatalog(): BlockInsertItem[] {
  return [
    {
      id: 'paragraph',
      title: '正文',
      description: '普通段落',
      keywords: ['paragraph', 'text', '正文', '段落'],
      icon: 'T',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().setParagraph().run()
      },
    },
    {
      id: 'h1',
      title: '标题 1',
      description: '一级标题',
      keywords: ['h1', 'heading', '标题'],
      icon: 'H1',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().setHeading({ level: 1 }).run()
      },
    },
    {
      id: 'h2',
      title: '标题 2',
      description: '二级标题',
      keywords: ['h2', 'heading', '标题'],
      icon: 'H2',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().setHeading({ level: 2 }).run()
      },
    },
    {
      id: 'h3',
      title: '标题 3',
      description: '三级标题',
      keywords: ['h3', 'heading', '标题'],
      icon: 'H3',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().setHeading({ level: 3 }).run()
      },
    },
    {
      id: 'ordered',
      title: '有序列表',
      description: '数字编号列表',
      keywords: ['ordered', 'ol', '有序', '编号'],
      icon: '1.',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().toggleOrderedList().run()
      },
    },
    {
      id: 'bullet',
      title: '无序列表',
      description: '项目符号列表',
      keywords: ['bullet', 'ul', '列表', '无序'],
      icon: '•',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().toggleBulletList().run()
      },
    },
    {
      id: 'task',
      title: '任务',
      description: '可勾选待办',
      keywords: ['task', 'todo', 'checkbox', '任务', '待办'],
      icon: '☑',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().toggleTaskList().run()
      },
    },
    {
      id: 'code',
      title: '代码块',
      description: '多行代码',
      keywords: ['code', 'codeblock', '代码'],
      icon: '{ }',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().toggleCodeBlock().run()
      },
    },
    {
      id: 'quote',
      title: '引用',
      description: '引用块',
      keywords: ['quote', 'blockquote', '引用'],
      icon: '❝',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().toggleBlockquote().run()
      },
    },
    {
      id: 'hr',
      title: '分割线',
      description: '水平分隔',
      keywords: ['hr', 'divider', '分割', '分隔'],
      icon: '—',
      section: 'basic',
      apply: (editor) => {
        editor.chain().focus().setHorizontalRule().run()
      },
    },
    {
      id: 'image',
      title: '图片',
      description: '插入图片',
      keywords: ['image', 'img', '图片', '照片'],
      icon: '🖼',
      section: 'common',
      apply: (editor) => {
        const host = editor as Editor & { __pagesInsertImage?: () => void }
        host.__pagesInsertImage?.()
      },
    },
    {
      id: 'table',
      title: '表格',
      description: '插入 3×3 表格',
      keywords: ['table', '表格'],
      icon: '⊞',
      section: 'common',
      apply: (editor) => {
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run()
        // 为新表写入稳定 id（insertTable 不支持自定义 attrs）
        const { state } = editor
        const $from = state.selection.$from
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d)
          if (node.type.name !== 'table') continue
          const pos = $from.before(d)
          if (!node.attrs.id) {
            editor
              .chain()
              .command(({ tr }) => {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  id: createTableId(),
                })
                return true
              })
              .run()
          }
          break
        }
      },
    },
  ]
}

export function filterBlockInsertItems(query: string): BlockInsertItem[] {
  const q = query.trim().toLowerCase()
  const all = buildBlockInsertCatalog()
  if (!q) return all
  return all.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
  )
}

/** 从文档位置解析顶层块（doc 的直接子节点） */
export function findTopLevelBlock(editor: Editor, pos: number): TopLevelBlock | null {
  const { doc } = editor.state
  const clamped = Math.max(0, Math.min(pos, doc.content.size))
  const $pos = doc.resolve(clamped)

  if ($pos.depth === 0) {
    const index = $pos.index()
    if (index >= doc.childCount) {
      if (doc.childCount === 0) return null
      const node = doc.child(doc.childCount - 1)
      let p = 0
      for (let i = 0; i < doc.childCount - 1; i++) p += doc.child(i).nodeSize
      return { node, pos: p }
    }
    const node = doc.child(index)
    let p = 0
    for (let i = 0; i < index; i++) p += doc.child(i).nodeSize
    return { node, pos: p }
  }

  const depth = 1
  const node = $pos.node(depth)
  const blockPos = $pos.before(depth)
  return { node, pos: blockPos }
}

/** 行侧加号所在 gutter 算进同一行的命中宽度（px） */
export const BLOCK_ROW_GUTTER_PX = 44

/**
 * 用「整行」（正文 + 左侧 gutter）做命中测试。
 * 指针在加号区域、从下方滑入 gutter，都应命中该行，而不是依赖 posAtCoords。
 */
export function findTopLevelBlockAtPoint(
  editor: Editor,
  clientX: number,
  clientY: number,
): TopLevelBlock | null {
  const { doc } = editor.state
  let pos = 0
  let best: TopLevelBlock | null = null
  let bestScore = Infinity

  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i)
    const dom = editor.view.nodeDOM(pos)
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect()
      const left = rect.left - BLOCK_ROW_GUTTER_PX
      const right = rect.right
      const top = rect.top
      const bottom = Math.max(rect.bottom, rect.top + 28)
      if (clientX >= left && clientX <= right && clientY >= top && clientY <= bottom) {
        const midY = (top + bottom) / 2
        const score = Math.abs(clientY - midY)
        if (score < bestScore) {
          bestScore = score
          best = { node, pos }
        }
      }
    }
    pos += node.nodeSize
  }

  return best
}

export function isEmptyConvertibleBlock(node: ProseMirrorNode): boolean {
  if (node.type.name === 'paragraph') {
    return node.content.size === 0
  }
  if (node.type.name === 'heading') {
    return node.content.size === 0
  }
  return false
}

function selectInsideBlock(editor: Editor, blockPos: number, node: ProseMirrorNode) {
  if (node.isTextblock) {
    const sel = TextSelection.create(editor.state.doc, blockPos + 1)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
    return
  }
  try {
    const sel = TextSelection.near(editor.state.doc.resolve(blockPos + 1), 1)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
  } catch {
    try {
      const sel = NodeSelection.create(editor.state.doc, blockPos)
      editor.view.dispatch(editor.state.tr.setSelection(sel))
    } catch {
      editor.commands.setTextSelection(Math.min(blockPos + 1, editor.state.doc.content.size))
    }
  }
}

export function selectBlockNode(editor: Editor, blockPos: number) {
  try {
    const sel = NodeSelection.create(editor.state.doc, blockPos)
    editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView())
    editor.view.focus()
  } catch {
    // ignore invalid positions
  }
}

export function deleteTopLevelBlock(editor: Editor, blockPos: number) {
  const block = findTopLevelBlock(editor, blockPos + 1)
  if (!block) return
  selectBlockNode(editor, block.pos)
  editor.chain().focus().deleteSelection().run()
}

/**
 * 在指定顶层块上应用插入项。
 * - replace-or-below：空段则就地转换；否则在下方新建空段再应用
 * - above / below：在块上/下方插入空段再应用
 * - convert：就地转换当前块类型
 */
export function applyBlockInsert(
  editor: Editor,
  blockPos: number,
  item: BlockInsertItem,
  mode: 'replace-or-below' | 'above' | 'below' | 'convert',
) {
  const block = findTopLevelBlock(editor, blockPos + 1) ?? findTopLevelBlock(editor, blockPos)
  if (!block) {
    item.apply(editor)
    return
  }

  const { node, pos } = block
  const end = pos + node.nodeSize

  if (mode === 'convert') {
    selectInsideBlock(editor, pos, node)
    item.apply(editor)
    return
  }

  if (mode === 'above') {
    editor
      .chain()
      .focus()
      .insertContentAt(pos, { type: 'paragraph' })
      .run()
    const next = findTopLevelBlock(editor, pos + 1)
    if (next) selectInsideBlock(editor, next.pos, next.node)
    item.apply(editor)
    return
  }

  if (mode === 'below') {
    editor
      .chain()
      .focus()
      .insertContentAt(end, { type: 'paragraph' })
      .run()
    const next = findTopLevelBlock(editor, end + 1)
    if (next) selectInsideBlock(editor, next.pos, next.node)
    item.apply(editor)
    return
  }

  // replace-or-below
  if (isEmptyConvertibleBlock(node) && item.id !== 'hr' && item.id !== 'table') {
    selectInsideBlock(editor, pos, node)
    item.apply(editor)
    return
  }

  if (isEmptyConvertibleBlock(node) && (item.id === 'hr' || item.id === 'table')) {
    selectInsideBlock(editor, pos, node)
    item.apply(editor)
    return
  }

  editor
    .chain()
    .focus()
    .insertContentAt(end, { type: 'paragraph' })
    .run()
  const next = findTopLevelBlock(editor, end + 1)
  if (next) selectInsideBlock(editor, next.pos, next.node)
  item.apply(editor)
}
