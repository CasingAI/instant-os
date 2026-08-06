import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export type FindMatch = { from: number; to: number }

export type PagesFindHighlightState = {
  matches: FindMatch[]
  currentIndex: number
}

export const pagesFindPluginKey = new PluginKey<PagesFindHighlightState>('pagesFind')

export function collectFindMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): FindMatch[] {
  const needle = query
  if (!needle) return []
  const matches: FindMatch[] = []
  const compareNeedle = caseSensitive ? needle : needle.toLowerCase()

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const haystack = caseSensitive ? node.text : node.text.toLowerCase()
    let start = 0
    while (start <= haystack.length) {
      const idx = haystack.indexOf(compareNeedle, start)
      if (idx === -1) break
      matches.push({ from: pos + idx, to: pos + idx + needle.length })
      start = idx + Math.max(1, compareNeedle.length)
    }
  })

  return matches
}

export function collectTextFindMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
): FindMatch[] {
  if (!query) return []
  const matches: FindMatch[] = []
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  let start = 0
  while (start <= haystack.length) {
    const idx = haystack.indexOf(needle, start)
    if (idx === -1) break
    matches.push({ from: idx, to: idx + query.length })
    start = idx + Math.max(1, needle.length)
  }
  return matches
}

export function setEditorFindHighlight(
  editor: Editor,
  matches: FindMatch[],
  currentIndex: number,
) {
  if (editor.isDestroyed) return
  const { tr } = editor.state
  tr.setMeta(pagesFindPluginKey, {
    matches,
    currentIndex: matches.length === 0 ? -1 : ((currentIndex % matches.length) + matches.length) % matches.length,
  } satisfies PagesFindHighlightState)
  editor.view.dispatch(tr)
}

export function clearEditorFindHighlight(editor: Editor) {
  setEditorFindHighlight(editor, [], -1)
}

export function selectFindMatch(editor: Editor, match: FindMatch) {
  if (editor.isDestroyed) return
  const sel = TextSelection.create(editor.state.doc, match.from, match.to)
  editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView())
  editor.view.focus()
}

export function replaceFindMatch(
  editor: Editor,
  match: FindMatch,
  replacement: string,
): boolean {
  if (editor.isDestroyed) return false
  const { tr } = editor.state
  tr.insertText(replacement, match.from, match.to)
  editor.view.dispatch(tr)
  return true
}

export function replaceAllFindMatches(
  editor: Editor,
  matches: FindMatch[],
  replacement: string,
): number {
  if (editor.isDestroyed || matches.length === 0) return 0
  let tr = editor.state.tr
  // 从后往前替换，避免偏移
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!
    tr = tr.insertText(replacement, match.from, match.to)
  }
  editor.view.dispatch(tr)
  return matches.length
}

export const PagesFindExtension = Extension.create({
  name: 'pagesFind',

  addProseMirrorPlugins() {
    return [
      new Plugin<PagesFindHighlightState>({
        key: pagesFindPluginKey,
        state: {
          init: () => ({ matches: [], currentIndex: -1 }),
          apply(tr, value) {
            const meta = tr.getMeta(pagesFindPluginKey) as PagesFindHighlightState | undefined
            if (meta) return meta
            if (!tr.docChanged || value.matches.length === 0) return value
            // 文档变更后由外部重算；此处清空以免错位高亮
            return { matches: [], currentIndex: -1 }
          },
        },
        props: {
          decorations(state) {
            const value = pagesFindPluginKey.getState(state)
            if (!value || value.matches.length === 0) return DecorationSet.empty
            const decorations = value.matches.map((match, index) =>
              Decoration.inline(match.from, match.to, {
                class:
                  index === value.currentIndex
                    ? 'pages-find-match pages-find-match--current'
                    : 'pages-find-match',
              }),
            )
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
