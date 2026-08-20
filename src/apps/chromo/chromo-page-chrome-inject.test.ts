/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-page-chrome-inject.test.ts
 */
import assert from 'node:assert/strict'
import { parseChromoContextMenuPayload } from '../../page-host/page-bridge.ts'
import { CHROMO_PAGE_CHROME_INJECT_SCRIPT } from './chromo-page-chrome-inject.ts'

function testInjectScript(): void {
  assert.ok(CHROMO_PAGE_CHROME_INJECT_SCRIPT.includes('VC_CONTEXTMENU'))
  assert.ok(CHROMO_PAGE_CHROME_INJECT_SCRIPT.includes('window.__chromoPageChrome'))
  assert.ok(CHROMO_PAGE_CHROME_INJECT_SCRIPT.includes('findSearch'))
  assert.ok(CHROMO_PAGE_CHROME_INJECT_SCRIPT.includes("data-chromo-find"))
  assert.ok(CHROMO_PAGE_CHROME_INJECT_SCRIPT.includes('srcset'))
  assert.ok(CHROMO_PAGE_CHROME_INJECT_SCRIPT.includes('auxclick'))
  assert.ok(CHROMO_PAGE_CHROME_INJECT_SCRIPT.includes('stopImmediatePropagation'))
  console.log('ok: inject script surface')
}

function testParseContextMenuPayload(): void {
  assert.deepEqual(
    parseChromoContextMenuPayload({
      x: 10,
      y: 20,
      linkUrl: ' https://example.com/a ',
      imageUrl: 'https://example.com/b.png',
      selection: ' hi ',
    }),
    {
      x: 10,
      y: 20,
      linkUrl: 'https://example.com/a',
      imageUrl: 'https://example.com/b.png',
      selection: ' hi ',
    },
  )
  assert.equal(parseChromoContextMenuPayload({ x: 'nope', y: 1 }), undefined)
  assert.equal(parseChromoContextMenuPayload(null), undefined)
  console.log('ok: parse context menu payload')
}

testInjectScript()
testParseContextMenuPayload()
console.log('chromo-page-chrome-inject tests passed')
