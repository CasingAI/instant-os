import { mergeAttributes, Node } from '@tiptap/core'

export type CalloutVariant = 'info' | 'tip' | 'warning' | 'danger'

export const CALLOUT_VARIANTS: { id: CalloutVariant; label: string }[] = [
  { id: 'info', label: '信息' },
  { id: 'tip', label: '提示' },
  { id: 'warning', label: '注意' },
  { id: 'danger', label: '危险' },
]

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { variant?: CalloutVariant }) => ReturnType
    }
    columns: {
      setColumns: (columnCount?: number) => ReturnType
    }
  }
}

export const Callout = Node.create({
  name: 'callout',

  group: 'block',

  content: 'block+',

  defining: true,

  addOptions() {
    return { HTMLAttributes: {} as Record<string, unknown> }
  },

  addAttributes() {
    return {
      variant: {
        default: 'info' satisfies CalloutVariant,
        parseHTML: (element) => {
          const value = element.getAttribute('data-variant')
          if (value === 'tip' || value === 'warning' || value === 'danger' || value === 'info') {
            return value
          }
          return 'info'
        },
        renderHTML: (attributes) => {
          const variant = (attributes.variant as CalloutVariant | undefined) ?? 'info'
          return { 'data-variant': variant }
        },
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'aside[data-type="callout"]' },
      { tag: 'div[data-type="callout"]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'aside',
      mergeAttributes(
        { 'data-type': 'callout', class: 'pages-editor__callout' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      0,
    ]
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { variant: attrs?.variant ?? 'info' },
            content: [{ type: 'paragraph' }],
          }),
    }
  },
})

export const Column = Node.create({
  name: 'column',

  content: 'block+',

  isolating: true,

  addOptions() {
    return { HTMLAttributes: {} as Record<string, unknown> }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'column', class: 'pages-editor__column-cell' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      0,
    ]
  },
})

export const Columns = Node.create({
  name: 'columns',

  group: 'block',

  content: 'column{2,}',

  defining: true,

  isolating: true,

  addOptions() {
    return { HTMLAttributes: {} as Record<string, unknown> }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'columns', class: 'pages-editor__columns' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      0,
    ]
  },

  addCommands() {
    return {
      setColumns:
        (columnCount = 2) =>
        ({ commands }) => {
          const count = Math.max(2, Math.min(3, Math.floor(columnCount)))
          const columns = Array.from({ length: count }, () => ({
            type: 'column',
            content: [{ type: 'paragraph' }],
          }))
          return commands.insertContent({
            type: this.name,
            content: columns,
          })
        },
    }
  },
})
