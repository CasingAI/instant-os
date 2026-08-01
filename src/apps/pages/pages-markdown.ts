import type { Extensions } from '@tiptap/core'
import {
  getRenderedAttributes,
  mergeAttributes,
  ResizableNodeView,
} from '@tiptap/core'
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

const PagesTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-table-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) return {}
          return { 'data-table-id': attributes.id }
        },
      },
    }
  },
})

function formulaCellAttributes() {
  return {
    formula: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute('data-formula')
        return value && value.trim() ? value.trim() : null
      },
      renderHTML: (attributes: Record<string, unknown>) => {
        const formula = attributes.formula
        if (typeof formula !== 'string' || !formula) return {}
        return {
          'data-formula': formula,
          title: formula,
        }
      },
    },
    formulaError: {
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute('data-formula-error') === 'true',
      renderHTML: (attributes: Record<string, unknown>) => {
        if (!attributes.formulaError) return {}
        return { 'data-formula-error': 'true' }
      },
    },
  }
}

const PagesTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...formulaCellAttributes(),
    }
  },
})

const PagesTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...formulaCellAttributes(),
    }
  },
})

export const PAGES_EMPTY_MARKDOWN = '# 无标题文档\n\n'

/** 文稿可打开的扩展名（原生包 + Markdown 兼容） */
export const PAGES_OPEN_EXTENSIONS = [PAGES_FILE_EXTENSION, 'md', 'markdown'] as const

/** 新插入图片的默认显示宽度（px） */
export const PAGES_IMAGE_DEFAULT_WIDTH = 360

/** 气泡预设：小 / 中 / 大 */
export const PAGES_IMAGE_WIDTH_PRESETS = [
  { label: '小', title: '窄图（240px）', width: 240 },
  { label: '中', title: '默认宽度（360px）', width: 360 },
  { label: '大', title: '较宽（520px）', width: 520 },
] as const

export type PagesImageAlign = 'left' | 'center' | 'right'

function applyImageDisplaySize(
  el: HTMLImageElement,
  width: number | null | undefined,
  height: number | null | undefined,
) {
  if (typeof width === 'number' && width > 0) {
    el.style.width = `${width}px`
    el.setAttribute('width', String(Math.round(width)))
  }
  if (typeof height === 'number' && height > 0) {
    el.style.height = `${height}px`
    el.setAttribute('height', String(Math.round(height)))
  } else if (typeof width === 'number' && width > 0) {
    el.style.height = 'auto'
    el.removeAttribute('height')
  }
}

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

  /**
   * TipTap 默认 NodeView 在 onUpdate 里跳过 width/height（只靠拖拽写 style）。
   * 气泡「小/中/大」走 updateAttributes，必须在此同步到 DOM，否则无视觉变化。
   */
  addNodeView() {
    if (!this.options.resize || !this.options.resize.enabled || typeof document === 'undefined') {
      return null
    }
    const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } = this.options.resize
    const resizeManagedAttributes = new Set(['src', 'width', 'height'])

    return ({ node, getPos, HTMLAttributes, editor }) => {
      const el = document.createElement('img')
      el.draggable = false
      const mergedAttributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)
      Object.entries(mergedAttributes).forEach(([key, value]) => {
        if (value == null) return
        if (key === 'src' || key === 'width' || key === 'height') return
        el.setAttribute(key, String(value))
      })
      if (mergedAttributes.src != null) {
        el.src = String(mergedAttributes.src)
      }

      let previousHTMLAttributes = { ...HTMLAttributes }
      const syncImageSource = (src: unknown) => {
        if (typeof src === 'string' && src !== '') {
          if (el.getAttribute('src') !== src) el.src = src
          return
        }
        if (el.hasAttribute('src')) el.removeAttribute('src')
        if (el.src !== '') el.src = ''
      }
      syncImageSource(HTMLAttributes.src)

      const onUpdate = (updatedNode: typeof node) => {
        if (updatedNode.type !== node.type) return false
        const extensionAttributes = editor.extensionManager.attributes.filter(
          (attribute) => attribute.type === updatedNode.type.name,
        )
        const newHTMLAttributes = getRenderedAttributes(updatedNode, extensionAttributes)
        Object.keys(previousHTMLAttributes).forEach((key) => {
          if (!resizeManagedAttributes.has(key) && !(key in newHTMLAttributes)) {
            el.removeAttribute(key)
          }
        })
        Object.entries(newHTMLAttributes).forEach(([key, value]) => {
          if (resizeManagedAttributes.has(key)) return
          if (value != null) el.setAttribute(key, String(value))
          else el.removeAttribute(key)
        })
        syncImageSource(newHTMLAttributes.src)
        // 关键：预设/程序改宽高时写回 style，否则只有文档属性变、画面不变
        applyImageDisplaySize(
          el,
          updatedNode.attrs.width as number | null | undefined,
          updatedNode.attrs.height as number | null | undefined,
        )
        previousHTMLAttributes = newHTMLAttributes
        return true
      }

      const nodeView = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          el.style.width = `${width}px`
          el.style.height = `${height}px`
        },
        onCommit: (width, height) => {
          const pos = getPos()
          if (pos === undefined) return
          this.editor
            .chain()
            .setNodeSelection(pos)
            .updateAttributes(this.name, { width, height })
            .run()
        },
        onUpdate,
        options: {
          directions,
          min: {
            width: minWidth,
            height: minHeight,
          },
          preserveAspectRatio: alwaysPreserveAspectRatio === true,
        },
      })

      const dom = nodeView.dom
      dom.style.visibility = 'hidden'
      dom.style.pointerEvents = 'none'
      el.onload = () => {
        dom.style.visibility = ''
        dom.style.pointerEvents = ''
      }
      return nodeView
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
      placeholder: '输入「/」插入块，或点左侧手柄打开操作菜单…',
    }),
    TaskList.configure({
      HTMLAttributes: { class: 'pages-editor__task-list' },
    }),
    TaskItem.configure({
      nested: true,
      HTMLAttributes: { class: 'pages-editor__task-item' },
    }),
    PagesTable.configure({
      resizable: true,
      HTMLAttributes: { class: 'pages-editor__table' },
    }),
    TableRow,
    PagesTableHeader,
    PagesTableCell,
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
