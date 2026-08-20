import assert from 'node:assert/strict'
import {
  clipboardLooksLikeTsvTable,
  extractGridFromClipboardDoc,
  extractGridFromHtml,
  extractGridFromTsv,
  mergeGridIntoTableJSON,
  promotePastedTableHeaderHtml,
  tsvToTableHtml,
  type PasteGrid,
} from './pages-table-paste.ts'

assert.equal(clipboardLooksLikeTsvTable('a\tb\n1\t2'), true)
assert.equal(clipboardLooksLikeTsvTable('hello\nworld'), false)
assert.equal(clipboardLooksLikeTsvTable('a\tb'), false)

{
  const table = tsvToTableHtml('供应商\t模型\nDeepseek\tFlash')
  assert.ok(table)
  assert.match(table, /<th><p>供应商<\/p><\/th>/)
  assert.match(table, /<th><p>模型<\/p><\/th>/)
  assert.match(table, /<td><p>Deepseek<\/p><\/td>/)
  assert.match(table, /<td><p>Flash<\/p><\/td>/)
}

{
  assert.equal(tsvToTableHtml('no tabs here\nstill none'), null)
}

if (typeof DOMParser !== 'undefined') {
  const html = promotePastedTableHeaderHtml(
    '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>',
  )
  assert.match(html, /<th[^>]*>A<\/th>/)
  assert.match(html, /<th[^>]*>B<\/th>/)
  assert.match(html, /<td[^>]*>1<\/td>/)

  const already =
    '<table><tr><th>A</th><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>'
  assert.equal(promotePastedTableHeaderHtml(already), already)

  const grid = extractGridFromHtml(
    '<table><tr><th>X</th><th>Y</th></tr><tr><td>1</td><td>=A1</td></tr></table>',
  )
  assert.ok(grid)
  assert.equal(grid[0]![0]!.text, 'X')
  assert.equal(grid[1]![0]!.text, '1')
  assert.equal(grid[1]![1]!.formula, '=A1')
}

{
  const tsvGrid = extractGridFromTsv('A\tB\n10\t20')
  assert.ok(tsvGrid)
  assert.equal(tsvGrid[0]![0]!.text, 'A')
  assert.equal(tsvGrid[1]![1]!.text, '20')
}

{
  const docGrid = extractGridFromClipboardDoc({
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H' }] }] },
              {
                type: 'tableCell',
                attrs: { formula: '=SUM(A1)' },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '0' }] }],
              },
            ],
          },
        ],
      },
    ],
  })
  assert.ok(docGrid)
  assert.equal(docGrid[0]![0]!.text, 'H')
  assert.equal(docGrid[0]![1]!.formula, '=SUM(A1)')
}

{
  const base = {
    type: 'table',
    attrs: { id: 'tbl-1' },
    content: [
      {
        type: 'tableRow',
        content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
        ],
      },
      {
        type: 'tableRow',
        content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
        ],
      },
    ],
  }

  // 覆盖：从 (0,1) 写入 1x1
  const overlay = mergeGridIntoTableJSON(base, 0, 1, [[{ text: 'BX', formula: null }]])
  assert.equal(overlay.attrs?.id, 'tbl-1')
  assert.equal(overlay.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]?.text, 'BX')
  assert.equal(overlay.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]?.text, '1')

  // 扩表：从 (1,1) 粘贴 2x2 → 需要 3 行 3 列
  const expandGrid: PasteGrid = [
    [
      { text: 'p', formula: null },
      { text: 'q', formula: null },
    ],
    [
      { text: 'r', formula: null },
      { text: 's', formula: '=A1' },
    ],
  ]
  const expanded = mergeGridIntoTableJSON(base, 1, 1, expandGrid)
  assert.equal(expanded.content?.length, 3)
  assert.equal(expanded.content?.[0]?.content?.length, 3)
  assert.equal(expanded.content?.[1]?.content?.[1]?.content?.[0]?.content?.[0]?.text, 'p')
  assert.equal(expanded.content?.[2]?.content?.[2]?.attrs?.formula, '=A1')
  assert.equal(expanded.content?.[2]?.content?.[2]?.content?.[0]?.content?.[0]?.text, 's')
}

{
  // 空网格不改变表
  const base = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }],
      },
    ],
  }
  const same = mergeGridIntoTableJSON(base, 0, 0, [])
  assert.equal(same.content?.length, 1)
}

console.log('pages-table-paste.smoke-test: ok')
