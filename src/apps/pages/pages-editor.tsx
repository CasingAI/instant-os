import { useEffect, useRef, useState } from 'preact/hooks'
import { Editor } from '@tiptap/core'
import { createPagesExtensions } from './pages-markdown.ts'
import type { SlashCommandItem } from './pages-slash-commands.ts'

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

function readMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } }
  return storage.markdown?.getMarkdown?.() ?? ''
}

function ToolbarButton({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      class={`pages-toolbar__btn${active ? ' pages-toolbar__btn--active' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active ? 'true' : 'false'}
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault()
        onClick()
      }}
    >
      {label}
    </button>
  )
}

export function PagesEditor({
  initialMarkdown,
  editable,
  viewMode,
  onMarkdownChange,
  onViewModeChange,
  onEditorReady,
}: PagesEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const slashMenuRef = useRef<SlashMenuState | null>(null)
  const onMarkdownChangeRef = useRef(onMarkdownChange)
  const onEditorReadyRef = useRef(onEditorReady)
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null)
  const [toolbarEpoch, setToolbarEpoch] = useState(0)
  const sourceDraftRef = useRef(initialMarkdown)
  const [sourceText, setSourceText] = useState(initialMarkdown)
  const suppressNextUpdateRef = useRef(false)
  const viewModeRef = useRef(viewMode)

  onMarkdownChangeRef.current = onMarkdownChange
  onEditorReadyRef.current = onEditorReady
  viewModeRef.current = viewMode

  const updateSlashMenu = (next: SlashMenuState | null) => {
    slashMenuRef.current = next
    setSlashMenu(next)
  }

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
      },
      onCreate: ({ editor: created }) => {
        suppressNextUpdateRef.current = true
        const markdown = readMarkdown(created)
        sourceDraftRef.current = markdown
        onMarkdownChangeRef.current(markdown)
        onEditorReadyRef.current?.(created)
      },
      onUpdate: ({ editor: current }) => {
        setToolbarEpoch((value) => value + 1)
        if (suppressNextUpdateRef.current) {
          suppressNextUpdateRef.current = false
          return
        }
        if (viewModeRef.current === 'source') return
        const markdown = readMarkdown(current)
        sourceDraftRef.current = markdown
        onMarkdownChangeRef.current(markdown)
      },
      onSelectionUpdate: () => {
        setToolbarEpoch((value) => value + 1)
      },
    })

    editorRef.current = editor

    return () => {
      onEditorReadyRef.current?.(null)
      editor.destroy()
      editorRef.current = null
      updateSlashMenu(null)
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
  }, [editable])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    if (viewMode === 'source') {
      const markdown = readMarkdown(editor)
      sourceDraftRef.current = markdown
      setSourceText(markdown)
      return
    }
    suppressNextUpdateRef.current = true
    editor.commands.setContent(sourceDraftRef.current)
    const normalized = readMarkdown(editor)
    sourceDraftRef.current = normalized
    onMarkdownChange(normalized)
  }, [viewMode, onMarkdownChange])

  const editor = editorRef.current
  void toolbarEpoch

  const run = (action: (chain: ReturnType<Editor['chain']>) => void) => {
    if (!editor || editor.isDestroyed || !editable || viewMode !== 'edit') return
    action(editor.chain().focus())
  }

  const promptLink = () => {
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

  const slashStyle =
    slashMenu?.rect != null
      ? {
          top: `${slashMenu.rect.bottom + 6}px`,
          left: `${slashMenu.rect.left}px`,
        }
      : undefined

  return (
    <div class="pages-editor">
      <div class="pages-toolbar" role="toolbar" aria-label="格式">
        <div class="pages-toolbar__group">
          <ToolbarButton
            label="编辑"
            title="可视化编辑"
            active={viewMode === 'edit'}
            onClick={() => onViewModeChange('edit')}
          />
          <ToolbarButton
            label="源码"
            title="Markdown 源码"
            active={viewMode === 'source'}
            onClick={() => onViewModeChange('source')}
          />
        </div>
        <div class="pages-toolbar__divider" />
        <div class="pages-toolbar__group">
          <ToolbarButton
            label="H1"
            title="标题 1"
            active={editor?.isActive('heading', { level: 1 })}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleHeading({ level: 1 }).run())}
          />
          <ToolbarButton
            label="H2"
            title="标题 2"
            active={editor?.isActive('heading', { level: 2 })}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleHeading({ level: 2 }).run())}
          />
          <ToolbarButton
            label="H3"
            title="标题 3"
            active={editor?.isActive('heading', { level: 3 })}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleHeading({ level: 3 }).run())}
          />
        </div>
        <div class="pages-toolbar__divider" />
        <div class="pages-toolbar__group">
          <ToolbarButton
            label="B"
            title="粗体"
            active={editor?.isActive('bold')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleBold().run())}
          />
          <ToolbarButton
            label="I"
            title="斜体"
            active={editor?.isActive('italic')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleItalic().run())}
          />
          <ToolbarButton
            label="U"
            title="下划线"
            active={editor?.isActive('underline')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleUnderline().run())}
          />
          <ToolbarButton
            label="S"
            title="删除线"
            active={editor?.isActive('strike')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleStrike().run())}
          />
          <ToolbarButton
            label="<>"
            title="行内代码"
            active={editor?.isActive('code')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleCode().run())}
          />
        </div>
        <div class="pages-toolbar__divider" />
        <div class="pages-toolbar__group">
          <ToolbarButton
            label="•"
            title="无序列表"
            active={editor?.isActive('bulletList')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleBulletList().run())}
          />
          <ToolbarButton
            label="1."
            title="有序列表"
            active={editor?.isActive('orderedList')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleOrderedList().run())}
          />
          <ToolbarButton
            label="☑"
            title="任务列表"
            active={editor?.isActive('taskList')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleTaskList().run())}
          />
          <ToolbarButton
            label="❝"
            title="引用"
            active={editor?.isActive('blockquote')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleBlockquote().run())}
          />
          <ToolbarButton
            label="{}"
            title="代码块"
            active={editor?.isActive('codeBlock')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.toggleCodeBlock().run())}
          />
          <ToolbarButton
            label="—"
            title="分割线"
            disabled={!editable || viewMode !== 'edit'}
            onClick={() => run((chain) => chain.setHorizontalRule().run())}
          />
          <ToolbarButton
            label="🔗"
            title="链接"
            active={editor?.isActive('link')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={promptLink}
          />
          <ToolbarButton
            label="⊞"
            title="插入表格"
            active={editor?.isActive('table')}
            disabled={!editable || viewMode !== 'edit'}
            onClick={() =>
              run((chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())
            }
          />
        </div>
      </div>

      <div class={`pages-editor__stage${viewMode === 'source' ? ' pages-editor__stage--source' : ''}`}>
        <div
          class="pages-editor__paper"
          style={{ display: viewMode === 'edit' ? undefined : 'none' }}
        >
          <div ref={hostRef} class="pages-editor__host" />
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

      {slashMenu && viewMode === 'edit' && slashMenu.items.length > 0 ? (
        <div class="pages-slash" style={slashStyle} role="listbox" aria-label="插入块">
          {slashMenu.items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === slashMenu.selectedIndex ? 'true' : 'false'}
              class={`pages-slash__item${index === slashMenu.selectedIndex ? ' pages-slash__item--active' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault()
                slashMenu.command(item)
              }}
            >
              <span class="pages-slash__title">{item.title}</span>
              <span class="pages-slash__desc">{item.description}</span>
            </button>
          ))}
        </div>
      ) : undefined}
    </div>
  )
}
