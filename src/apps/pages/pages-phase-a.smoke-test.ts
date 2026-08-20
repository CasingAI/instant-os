/**
 * 运行：node --experimental-strip-types src/apps/pages/pages-phase-a.smoke-test.ts
 *
 * 不依赖 DOM（Markdown HTML 序列化需 window）；覆盖 schema 节点与查找。
 */
import assert from 'node:assert/strict'
import { Editor } from '@tiptap/core'
import { createPagesExtensions } from './pages-markdown.ts'
import { collectFindMatches, collectTextFindMatches } from './pages-find.ts'

const editor = new Editor({
  extensions: createPagesExtensions(),
  content: {
    type: 'doc',
    content: [
      {
        type: 'callout',
        attrs: { variant: 'warning' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '注意内容' }] }],
      },
      {
        type: 'details',
        attrs: { open: true },
        content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: '折叠标题' }] },
          {
            type: 'detailsContent',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '折叠正文' }] }],
          },
        ],
      },
      {
        type: 'columns',
        content: [
          {
            type: 'column',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '左栏 find' }] }],
          },
          {
            type: 'column',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '右栏' }] }],
          },
        ],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: [{ type: 'text', text: 'const answer = 42' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'hello find world find again' }],
      },
    ],
  },
  editable: false,
})

try {
  const names = Object.keys(editor.schema.nodes)
  for (const name of ['callout', 'details', 'detailsSummary', 'detailsContent', 'columns', 'column', 'codeBlock']) {
    assert.ok(names.includes(name), `missing schema node: ${name}`)
  }

  assert.equal(editor.commands.setCallout({ variant: 'tip' }), true)
  assert.equal(editor.commands.setColumns(2), true)

  const matches = collectFindMatches(editor.state.doc, 'find', false)
  assert.ok(matches.length >= 2, `expected >=2 find matches, got ${matches.length}`)

  const textMatches = collectTextFindMatches('Aa Bb aa', 'aa', false)
  assert.equal(textMatches.length, 2)
  const caseMatches = collectTextFindMatches('Aa Bb aa', 'aa', true)
  assert.equal(caseMatches.length, 1)

  console.log('pages-phase-a.smoke-test: ok')
} finally {
  editor.destroy()
}
