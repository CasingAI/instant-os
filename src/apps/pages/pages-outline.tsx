import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'

export type OutlineItem = {
  id: string
  level: 1 | 2 | 3
  text: string
  pos: number
}

export function collectOutlineItems(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const level = (node.attrs.level ?? 1) as 1 | 2 | 3
    if (level < 1 || level > 3) return
    const text = node.textContent.trim() || `标题 ${level}`
    items.push({
      id: `h-${pos}`,
      level,
      text,
      pos,
    })
  })
  return items
}

export function collectOutlineFromJSON(doc: JSONContent): OutlineItem[] {
  const items: OutlineItem[] = []
  let fakePos = 1
  const walk = (node: JSONContent) => {
    if (node.type === 'heading') {
      const level = (node.attrs?.level ?? 1) as 1 | 2 | 3
      const text =
        node.content?.map((c) => c.text ?? '').join('').trim() || `标题 ${level}`
      items.push({ id: `h-${fakePos}`, level, text, pos: fakePos })
    }
    fakePos += 1
    node.content?.forEach(walk)
  }
  walk(doc)
  return items
}

export type PagesOutlineProps = {
  items: OutlineItem[]
  onJump: (pos: number) => void
}

export function PagesOutline({ items, onJump }: PagesOutlineProps) {
  return (
    <nav class="pages-outline" aria-label="文档大纲">
      <div class="pages-outline__title">大纲</div>
      {items.length === 0 ? (
        <div class="pages-outline__empty">暂无标题</div>
      ) : (
        <ul class="pages-outline__list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                class={`pages-outline__item pages-outline__item--h${item.level}`}
                onClick={() => onJump(item.pos)}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
