import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import { Markdown } from 'tiptap-markdown'
import { createSlashCommandsExtension, type SlashCommandItem } from './pages-slash-commands.ts'
import { PAGES_FILE_EXTENSION } from './pages-package.ts'

export const PAGES_EMPTY_MARKDOWN = '# 无标题文档\n\n'

/** 文稿可打开的扩展名（原生包 + Markdown 兼容） */
export const PAGES_OPEN_EXTENSIONS = [PAGES_FILE_EXTENSION, 'md', 'markdown'] as const

/** 新插入图片的默认显示宽度（px） */
export const PAGES_IMAGE_DEFAULT_WIDTH = 360

export type PagesImageAlign = 'left' | 'center' | 'right'

const PagesImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: 'left' satisfies PagesImageAlign,
        parseHTML: (element) => {
          const value = element.getAttribute('data-align')
          if (value === 'center' || value === 'right' || value === 'left') return value
          return 'left'
        },
        renderHTML: (attributes) => {
          const align = attributes.align as PagesImageAlign | null | undefined
          if (!align || align === 'left') return {}
          return { 'data-align': align }
        },
      },
    }
  },
})

export type PagesSlashHandlers = {
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

/** TipTap 扩展集（含 Markdown 序列化与斜杠命令） */
export function createPagesExtensions(slash?: PagesSlashHandlers): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: {
        HTMLAttributes: { class: 'pages-editor__code-block' },
      },
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: 'pages-editor__link' },
      },
    }),
    Underline,
    PagesImage.configure({
      inline: false,
      allowBase64: false,
      HTMLAttributes: { class: 'pages-editor__image' },
      resize: {
        enabled: true,
        directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        minWidth: 96,
        minHeight: 72,
        alwaysPreserveAspectRatio: true,
      },
    }),
    Placeholder.configure({
      placeholder: '输入「/」或点左侧「+」插入块…',
    }),
    TaskList.configure({
      HTMLAttributes: { class: 'pages-editor__task-list' },
    }),
    TaskItem.configure({
      nested: true,
      HTMLAttributes: { class: 'pages-editor__task-item' },
    }),
    Table.configure({
      resizable: true,
      HTMLAttributes: { class: 'pages-editor__table' },
    }),
    TableRow,
    TableHeader,
    TableCell,
    Markdown.configure({
      html: true,
      tightLists: true,
      bulletListMarker: '-',
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ]

  if (slash) {
    extensions.push(createSlashCommandsExtension(slash))
  }

  return extensions
}
