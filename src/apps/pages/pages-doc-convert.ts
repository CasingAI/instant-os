import { Editor, type JSONContent } from '@tiptap/core'
import { createPagesExtensions } from './pages-markdown.ts'

/** 在浏览器中把 Markdown 解析为 TipTap JSON（一次性临时 Editor） */
export function markdownToJSONContent(markdown: string): JSONContent {
  const editor = new Editor({
    extensions: createPagesExtensions(),
    content: markdown || '',
    editable: false,
  })
  try {
    return editor.getJSON()
  } finally {
    editor.destroy()
  }
}

/** TipTap JSON → Markdown 文本 */
export function jsonContentToMarkdown(doc: JSONContent): string {
  const editor = new Editor({
    extensions: createPagesExtensions(),
    content: doc,
    editable: false,
  })
  try {
    const storage = editor.storage as { markdown?: { getMarkdown?: () => string } }
    return storage.markdown?.getMarkdown?.() ?? ''
  } finally {
    editor.destroy()
  }
}
