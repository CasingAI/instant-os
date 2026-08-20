import type { Editor, JSONContent } from '@tiptap/core'
import { jsonContentToMarkdown } from './pages-doc-convert.ts'
import { recalculateAllTablesInEditor } from './pages-table-formula.ts'
import {
  clipboardLooksLikeTsvTable,
  extractGridFromClipboardDoc,
  extractGridFromHtml,
  extractGridFromTsv,
  promotePastedTableHeaderHtml,
  tryMergePasteGridIntoSelection,
  tsvToTableHtml,
  type PasteGrid,
} from './pages-table-paste.ts'

const PAGES_CLIP_MIME = 'application/x-instant-pages-fragment+json'

export async function copyEditorSelection(editor: Editor): Promise<void> {
  const { state } = editor
  const slice = state.selection.content()
  const fragmentJson = slice.content.toJSON()
  const tempDoc = { type: 'doc', content: Array.isArray(fragmentJson) ? fragmentJson : [fragmentJson] }
  const markdown = jsonContentToMarkdown(tempDoc as never)
  const plain = state.doc.textBetween(state.selection.from, state.selection.to, '\n')

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      const item = new ClipboardItem({
        'text/plain': new Blob([markdown || plain], { type: 'text/plain' }),
        [PAGES_CLIP_MIME]: new Blob([JSON.stringify(tempDoc)], { type: PAGES_CLIP_MIME }),
      })
      await navigator.clipboard.write([item])
      return
    }
  } catch {
    // fall through
  }
  await navigator.clipboard.writeText(markdown || plain)
}

export async function cutEditorSelection(editor: Editor): Promise<void> {
  await copyEditorSelection(editor)
  editor.chain().focus().deleteSelection().run()
}

function finishTableMerge(editor: Editor): void {
  recalculateAllTablesInEditor(editor)
}

/** 尝试把网格合并进当前表；成功返回 true。 */
export function tryPasteGridIntoEditor(editor: Editor, grid: PasteGrid | null): boolean {
  if (!tryMergePasteGridIntoSelection(editor, grid)) return false
  finishTableMerge(editor)
  return true
}

export async function pasteIntoEditor(editor: Editor): Promise<void> {
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        if (item.types.includes(PAGES_CLIP_MIME)) {
          const blob = await item.getType(PAGES_CLIP_MIME)
          const raw = await blob.text()
          const parsed = JSON.parse(raw) as JSONContent
          if (parsed?.type === 'doc' && parsed.content) {
            const grid = extractGridFromClipboardDoc(parsed)
            if (tryPasteGridIntoEditor(editor, grid)) return
            editor.commands.insertContent(parsed as Parameters<Editor['commands']['insertContent']>[0])
            return
          }
        }
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            const file = new File([blob], `paste.${type.split('/')[1] ?? 'png'}`, { type })
            ;(editor as Editor & { __pagesPasteImage?: (file: File) => void }).__pagesPasteImage?.(
              file,
            )
            return
          }
        }
        if (item.types.includes('text/html')) {
          const blob = await item.getType('text/html')
          const html = promotePastedTableHeaderHtml(await blob.text())
          if (html.trim()) {
            const grid = extractGridFromHtml(html)
            if (tryPasteGridIntoEditor(editor, grid)) return
            editor.chain().focus().insertContent(html).run()
            return
          }
        }
      }
    }
  } catch {
    // fall through to text
  }

  try {
    const text = await navigator.clipboard.readText()
    if (!text) return
    if (clipboardLooksLikeTsvTable(text)) {
      const grid = extractGridFromTsv(text)
      if (tryPasteGridIntoEditor(editor, grid)) return
      const tableHtml = tsvToTableHtml(text)
      if (tableHtml) {
        editor.chain().focus().insertContent(tableHtml).run()
        return
      }
    }
    editor.chain().focus().insertContent(text).run()
  } catch {
    // ignore
  }
}
