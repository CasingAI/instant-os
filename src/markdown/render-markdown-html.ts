import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import 'katex/dist/katex.min.css'
import './markdown-katex.css'

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'hr',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  // KaTeX HTML + MathML
  'span',
  'div',
  'math',
  'semantics',
  'mrow',
  'mi',
  'mo',
  'mn',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'msqrt',
  'mroot',
  'mtable',
  'mtr',
  'mtd',
  'mstyle',
  'mspace',
  'mtext',
  'annotation',
  'mover',
  'munder',
  'munderover',
  'mmultiscripts',
  'mprescripts',
  'none',
  'menclose',
  'mpadded',
  'mphantom',
  'mlabeledtr',
  'svg',
  'path',
] as const

const ALLOWED_ATTR = [
  'href',
  'title',
  'align',
  'class',
  'style',
  'aria-hidden',
  'aria-label',
  'role',
  'xmlns',
  'display',
  'encoding',
  'stretchy',
  'fence',
  'separator',
  'displaystyle',
  'scriptlevel',
  'mathvariant',
  'lspace',
  'rspace',
  'width',
  'height',
  'depth',
  'voffset',
  'columnalign',
  'rowalign',
  'columnspacing',
  'rowspacing',
  'columnlines',
  'rowlines',
  'frame',
  'framespacing',
  'equalrows',
  'equalcolumns',
  'side',
  'minlabelspacing',
  'notation',
  'viewBox',
  'preserveAspectRatio',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'focusable',
] as const

const markdownMarked = new Marked()
markdownMarked.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
  }),
)

export type RenderMarkdownHtmlOptions = {
  /** 解析前预处理源文本 */
  normalize?: (text: string) => string
  /** 为 <table> 外包一层容器；传入 class 名 */
  tableWrapClass?: string
  /** 是否先 trim；默认 true */
  trim?: boolean
}

function wrapMarkdownTables(html: string, tableWrapClass: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml) => {
    return `<div class="${tableWrapClass}">${tableHtml}</div>`
  })
}

/** 统一 Markdown → 消毒 HTML（GFM + KaTeX） */
export function renderMarkdownHtml(
  text: string,
  options?: RenderMarkdownHtmlOptions,
): string {
  const trim = options?.trim !== false
  const sourceText = trim ? text.trim() : text
  if (!sourceText) return ''

  const normalized = options?.normalize ? options.normalize(sourceText) : sourceText
  const raw = markdownMarked.parse(normalized, {
    async: false,
    gfm: true,
    breaks: true,
  })
  const sanitized = DOMPurify.sanitize(typeof raw === 'string' ? raw : String(raw), {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
  })
  if (!options?.tableWrapClass) return sanitized
  return wrapMarkdownTables(sanitized, options.tableWrapClass)
}
