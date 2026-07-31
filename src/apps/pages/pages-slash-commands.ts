import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import {
  buildBlockInsertCatalog,
  filterBlockInsertItems,
  type BlockInsertItem,
} from './pages-block-insert.ts'

export type SlashCommandItem = {
  id: string
  title: string
  description: string
  keywords: string[]
  icon: string
  section: BlockInsertItem['section']
  command: (ctx: { editor: Editor; range: Range }) => void
}

const slashPluginKey = new PluginKey('pagesSlashCommands')

function toSlashItem(item: BlockInsertItem): SlashCommandItem {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    keywords: item.keywords,
    icon: item.icon,
    section: item.section,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      item.apply(editor)
    },
  }
}

export function buildSlashCommandItems(): SlashCommandItem[] {
  return buildBlockInsertCatalog().map(toSlashItem)
}

function filterSlashItems(query: string): SlashCommandItem[] {
  return filterBlockInsertItems(query).map(toSlashItem)
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
