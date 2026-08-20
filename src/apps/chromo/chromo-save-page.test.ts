/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-save-page.test.ts
 */
import assert from 'node:assert/strict'
import {
  CHROMO_SAVE_PAGE_MAX_RESOURCE_BYTES,
  CHROMO_SAVE_PAGE_MAX_TOTAL_BYTES,
  canAcceptChromoSaveResource,
  parsePageSerializeResult,
  resourceFileNameFromUrl,
  rewriteHtmlResourceUrls,
  sanitizePageFileBaseName,
} from './chromo-save-page.ts'

function testSanitizePageFileBaseName(): void {
  assert.equal(sanitizePageFileBaseName('Hello World'), 'Hello World')
  assert.equal(sanitizePageFileBaseName('a/b:c'), 'a_b_c')
  assert.equal(sanitizePageFileBaseName('   '), 'page')
  assert.equal(sanitizePageFileBaseName('x'.repeat(120)).length, 80)
  console.log('ok: sanitize page file base name')
}

function testResourceFileNames(): void {
  const used = new Set<string>()
  assert.equal(resourceFileNameFromUrl('https://cdn.example/img/logo.png?w=2', used), 'logo.png')
  assert.equal(resourceFileNameFromUrl('https://other.example/logo.png', used), 'logo-2.png')
  assert.equal(resourceFileNameFromUrl('https://example.com/style', used), 'style.bin')
  console.log('ok: resource file names')
}

function testRewriteUrls(): void {
  const html =
    '<img src="https://cdn.example/a.png"><img src="/a.png"><link href="https://cdn.example/a.css">'
  const out = rewriteHtmlResourceUrls(html, [
    {
      url: 'https://cdn.example/a.png',
      original: '/a.png',
      relative: 'page_files/a.png',
    },
    {
      url: 'https://cdn.example/a.css',
      relative: 'page_files/a.css',
    },
  ])
  assert.equal(
    out,
    '<img src="page_files/a.png"><img src="page_files/a.png"><link href="page_files/a.css">',
  )
  console.log('ok: rewrite resource urls')
}

function testResourceLimits(): void {
  assert.equal(canAcceptChromoSaveResource(CHROMO_SAVE_PAGE_MAX_RESOURCE_BYTES, 0), true)
  assert.equal(canAcceptChromoSaveResource(CHROMO_SAVE_PAGE_MAX_RESOURCE_BYTES + 1, 0), false)
  assert.equal(canAcceptChromoSaveResource(1, CHROMO_SAVE_PAGE_MAX_TOTAL_BYTES), false)
  assert.equal(canAcceptChromoSaveResource(1024, CHROMO_SAVE_PAGE_MAX_TOTAL_BYTES - 1024), true)
  console.log('ok: resource size limits')
}

function testParseSerializeResult(): void {
  const parsed = parsePageSerializeResult({
    title: 'Hi',
    url: 'https://example.com/',
    html: '<html></html>',
    resources: [
      'https://example.com/a.png',
      { url: 'https://example.com/b.png', original: '/b.png' },
      { url: 'https://example.com/a.png', original: 'a.png' },
    ],
  })
  assert.equal(parsed.resources.length, 2)
  assert.equal(parsed.resources[0]?.url, 'https://example.com/a.png')
  assert.equal(parsed.resources[1]?.original, '/b.png')
  console.log('ok: parse serialize result')
}

testSanitizePageFileBaseName()
testResourceFileNames()
testRewriteUrls()
testResourceLimits()
testParseSerializeResult()
console.log('chromo-save-page tests passed')
