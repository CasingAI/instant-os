import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'

export type SlashCommandItem = {
  id: string
  title: string
  description: string
  keywords: string[]
  command: (ctx: { editor: Editor; range: Range }) => void
}

const slashPluginKey = new PluginKey('pagesSlashCommands')

export function buildSlashCommandItems(): SlashCommandItem[] {
  return [
    {
      id: 'paragraph',
      title: '正文',
      description: '普通段落',
      keywords: ['paragraph', 'text', '正文', '段落'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setParagraph().run()
      },
    },
    {
      id: 'h1',
      title: '标题 1',
      description: '一级标题',
      keywords: ['h1', 'heading', '标题'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
      },
    },
    {
      id: 'h2',
      title: '标题 2',
      description: '二级标题',
      keywords: ['h2', 'heading', '标题'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
      },
    },
    {
      id: 'h3',
      title: '标题 3',
      description: '三级标题',
      keywords: ['h3', 'heading', '标题'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
      },
    },
    {
      id: 'bullet',
      title: '无序列表',
      description: '项目符号列表',
      keywords: ['bullet', 'ul', '列表', '无序'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
      },
    },
    {
      id: 'ordered',
      title: '有序列表',
      description: '数字编号列表',
      keywords: ['ordered', 'ol', '有序', '编号'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
      },
    },
    {
      id: 'task',
      title: '任务列表',
      description: '可勾选待办',
      keywords: ['task', 'todo', 'checkbox', '任务', '待办'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run()
      },
    },
    {
      id: 'quote',
      title: '引用',
      description: '引用块',
      keywords: ['quote', 'blockquote', '引用'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
      },
    },
    {
      id: 'code',
      title: '代码块',
      description: '多行代码',
      keywords: ['code', 'codeblock', '代码'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
      },
    },
    {
      id: 'hr',
      title: '分割线',
      description: '水平分隔',
      keywords: ['hr', 'divider', '分割', '分隔'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
      },
    },
    {
      id: 'table',
      title: '表格',
      description: '插入 3×3 表格',
      keywords: ['table', '表格'],
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run()
      },
    },
  ]
}

function filterSlashItems(query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase()
  const all = buildSlashCommandItems()
  if (!q) return all
  return all.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
  )
}

export type SlashCommandsHost = {
  items: SlashCommandItem[]
  onOpen: (props: {
    items: SlashCommandItem[]
    clientRect: (() => DOMRect | null) | null
    command: (item: SlashCommandItem) => void
  }) => void
  onUpdate: (props: {
    items: SlashCommandItem[]
    clientRect: (() => DOMRect | null) | null
    command: (item: SlashCommandItem) => void
  }) => void
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
  onClose: () => void
}

export function createSlashCommandsExtension(host: SlashCommandsHost) {
  return Extension.create({
    name: 'pagesSlashCommands',

    addOptions() {
      return {
        suggestion: {
          char: '/',
          pluginKey: slashPluginKey,
          allowSpaces: false,
          startOfLine: false,
          allowedPrefixes: [' ', '　', '\u00A0'],
          items: ({ query }: { query: string }) => filterSlashItems(query),
          command: ({
            editor,
            range,
            props,
          }: {
            editor: Editor
            range: Range
            props: SlashCommandItem
          }) => {
            props.command({ editor, range })
          },
          render: () => {
            return {
              onStart: (props: SuggestionProps<SlashCommandItem>) => {
                host.onOpen({
                  items: props.items,
                  clientRect: props.clientRect ?? null,
                  command: (item) => props.command(item),
                })
              },
              onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
                host.onUpdate({
                  items: props.items,
                  clientRect: props.clientRect ?? null,
                  command: (item) => props.command(item),
                })
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') {
                  host.onClose()
                  return true
                }
                return host.onKeyDown({ event: props.event })
              },
              onExit: () => {
                host.onClose()
              },
            }
          },
        },
      }
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ]
    },
  })
}
