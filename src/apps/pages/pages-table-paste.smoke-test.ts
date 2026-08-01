import assert from 'node:assert/strict'
import {
  clipboardLooksLikeTsvTable,
  promotePastedTableHeaderHtml,
  tsvToTableHtml,
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
}

console.log('pages-table-paste.smoke-test: ok')
