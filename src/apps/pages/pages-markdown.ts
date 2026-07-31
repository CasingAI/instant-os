import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'
import { createSlashCommandsExtension, type SlashCommandItem } from './pages-slash-commands.ts'

export const PAGES_EMPTY_MARKDOWN = '# 无标题文档\n\n'

export const PAGES_OPEN_EXTENSIONS = ['md', 'markdown'] as const

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
    Placeholder.configure({
      placeholder: '输入「/」插入块，或直接开始书写…',
    }),
    TaskList.configure({
      HTMLAttributes: { class: 'pages-editor__task-list' },
    }),
    TaskItem.configure({
      nested: true,
      HTMLAttributes: { class: 'pages-editor__task-item' },
    }),
    Table.configure({
      resizable: false,
      HTMLAttributes: { class: 'pages-editor__table' },
    }),
    TableRow,
    TableHeader,
    TableCell,
    Markdown.configure({
      html: false,
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
