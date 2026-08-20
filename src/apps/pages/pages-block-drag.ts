import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { findTopLevelBlock, findTopLevelBlockAtPoint } from './pages-block-insert.ts'

export type BlockDragGhost = {
  top: number
  left: number
  width: number
  label: string
}

export type BlockDropIndicator = {
  top: number
  left: number
  width: number
}

export type BlockDragSession = {
  fromPos: number
  label: string
  ghost: BlockDragGhost
  dropIndex: number | null
  indicator: BlockDropIndicator | null
}

function blockLabel(editor: Editor, pos: number): string {
  const block = findTopLevelBlock(editor, pos + 1)
  if (!block) return '块'
  const text = block.node.textContent.trim()
  if (text) return text.slice(0, 24)
  return block.node.type.name
}

function listTopLevelRects(editor: Editor): { pos: number; top: number; bottom: number; left: number; width: number }[] {
  const { doc } = editor.state
  const out: { pos: number; top: number; bottom: number; left: number; width: number }[] = []
  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i)
    const dom = editor.view.nodeDOM(pos)
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect()
      out.push({
        pos,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
      })
    }
    pos += node.nodeSize
  }
  return out
}

/** 根据指针 Y 计算插入到第几个顶层块之前（0..childCount） */
export function dropIndexAtPoint(editor: Editor, clientY: number): number {
  const rects = listTopLevelRects(editor)
  if (rects.length === 0) return 0
  for (let i = 0; i < rects.length; i++) {
    const mid = (rects[i].top + rects[i].bottom) / 2
    if (clientY < mid) return i
  }
  return rects.length
}

export function dropIndicatorForIndex(
  editor: Editor,
  index: number,
  rootRect: DOMRect,
): BlockDropIndicator | null {
  const rects = listTopLevelRects(editor)
  if (rects.length === 0) return null
  // 落点线始终按编辑区内容全宽，不跟窄块（如图片）收缩
  const proseRect = editor.view.dom.getBoundingClientRect()
  let y: number
  if (index <= 0) {
    y = rects[0].top
  } else if (index >= rects.length) {
    y = rects[rects.length - 1].bottom
  } else {
    y = rects[index].top
  }
  return {
    // 3px 线居中对齐到块缝；略上移避免贴死下一块顶边
    top: y - rootRect.top - 2,
    left: proseRect.left - rootRect.left,
    width: proseRect.width,
  }
}

export function startBlockDrag(
  editor: Editor,
  blockPos: number,
  clientX: number,
  clientY: number,
  rootRect: DOMRect,
): BlockDragSession {
  const label = blockLabel(editor, blockPos)
  return {
    fromPos: blockPos,
    label,
    ghost: {
      top: clientY - rootRect.top + 8,
      left: clientX - rootRect.left + 8,
      width: 180,
      label,
    },
    dropIndex: null,
    indicator: null,
  }
}

export function updateBlockDrag(
  editor: Editor,
  session: BlockDragSession,
  clientX: number,
  clientY: number,
  rootRect: DOMRect,
): BlockDragSession {
  const dropIndex = dropIndexAtPoint(editor, clientY)
  return {
    ...session,
    ghost: {
      ...session.ghost,
      top: clientY - rootRect.top + 8,
      left: clientX - rootRect.left + 8,
    },
    dropIndex,
    indicator: dropIndicatorForIndex(editor, dropIndex, rootRect),
  }
}

/** 将 fromPos 处顶层块移到 targetIndex（移动后的目标下标） */
export function commitBlockReorder(
  editor: Editor,
  fromPos: number,
  targetIndex: number,
): boolean {
  const { doc } = editor.state
  let fromIndex = -1
  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    if (pos === fromPos) {
      fromIndex = i
      break
    }
    pos += doc.child(i).nodeSize
  }
  if (fromIndex < 0) return false

  let insertIndex = targetIndex
  if (insertIndex > fromIndex) insertIndex -= 1
  if (insertIndex === fromIndex) return false

  const node = doc.child(fromIndex)
  let tr = editor.state.tr
  // delete
  let delPos = 0
  for (let i = 0; i < fromIndex; i++) delPos += doc.child(i).nodeSize
  tr = tr.delete(delPos, delPos + node.nodeSize)

  // insert at new index in the *updated* doc
  const afterDoc = tr.doc
  let insPos = 0
  const clamped = Math.max(0, Math.min(insertIndex, afterDoc.childCount))
  for (let i = 0; i < clamped; i++) insPos += afterDoc.child(i).nodeSize
  tr = tr.insert(insPos, node)

  editor.view.dispatch(tr.scrollIntoView())
  try {
    const sel = NodeSelection.create(editor.state.doc, insPos)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
  } catch {
    // ignore
  }
  return true
}

export function blockPosUnderPoint(editor: Editor, clientX: number, clientY: number): number | null {
  return findTopLevelBlockAtPoint(editor, clientX, clientY)?.pos ?? null
}
