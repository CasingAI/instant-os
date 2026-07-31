import type { Editor } from '@tiptap/core'

export type BubbleMode = 'text' | 'block'

export type PagesBubbleMenuProps = {
  editor: Editor
  mode: BubbleMode
  style?: Record<string, string | number>
  onPromptLink: () => void
  onConvertBlock: () => void
  onCopyBlock: () => void
  onDeleteBlock: () => void
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

export function PagesBubbleMenu({
  editor,
  mode,
  style,
  onPromptLink,
  onConvertBlock,
  onCopyBlock,
  onDeleteBlock,
}: PagesBubbleMenuProps) {
  if (mode === 'block') {
    return (
      <div class="pages-bubble" style={style} role="toolbar" aria-label="块操作">
        <BubbleBtn label="复制" title="复制块" onClick={onCopyBlock} />
        <BubbleBtn label="删除" title="删除块" onClick={onDeleteBlock} />
        <span class="pages-bubble__divider" />
        <BubbleBtn label="转成…" title="转换块类型" onClick={onConvertBlock} />
      </div>
    )
  }

  return (
    <div class="pages-bubble" style={style} role="toolbar" aria-label="文字格式">
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
