import type { Editor } from '@tiptap/core'
import type { PagesImageAlign } from './pages-markdown.ts'

export type BubbleMode = 'text' | 'block' | 'image'

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

const IMAGE_WIDTH_PRESETS = [
  { label: '小', title: '窄图', width: 240 },
  { label: '中', title: '默认宽度', width: 360 },
  { label: '大', title: '较宽', width: 520 },
] as const

function setImageAlign(editor: Editor, align: PagesImageAlign) {
  editor.chain().focus().updateAttributes('image', { align }).run()
}

function setImageWidth(editor: Editor, width: number) {
  const attrs = editor.getAttributes('image') as {
    width?: number | null
    height?: number | null
  }
  const currentW = typeof attrs.width === 'number' && attrs.width > 0 ? attrs.width : width
  const currentH = typeof attrs.height === 'number' && attrs.height > 0 ? attrs.height : null
  const height =
    currentH && currentW > 0 ? Math.max(1, Math.round((currentH * width) / currentW)) : null
  editor
    .chain()
    .focus()
    .updateAttributes('image', height ? { width, height } : { width })
    .run()
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
  if (mode === 'image') {
    const align = (editor.getAttributes('image').align as PagesImageAlign | undefined) ?? 'left'
    const width = Number(editor.getAttributes('image').width) || 0
    return (
      <div class="pages-bubble" style={style} role="toolbar" aria-label="图片操作">
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
        {IMAGE_WIDTH_PRESETS.map((preset) => (
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
