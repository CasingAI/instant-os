/**
 * 版本文件夹按目录加载（纯函数重写引擎）单测。
 * 运行：node --experimental-strip-types src/apps/generated/generated-app-site-html.test.ts
 *
 * 覆盖：入口缺失 → undefined（空白页）；同目录/子目录/根相对引用重写为 data: URL；
 * CSS url()/srcset；树外逃逸不重写；动态 fetch shim 注入。
 */
import assert from 'node:assert/strict'
import {
  buildSiteDocument,
  EMPTY_SITE_DOCUMENT,
  normalizeSitePath,
  resolveSiteRef,
  siteMimeForPath,
} from './generated-app-site-html.ts'

function resources(entries: Record<string, string>): Map<string, Uint8Array> {
  const encoder = new TextEncoder()
  const map = new Map<string, Uint8Array>()
  for (const [path, text] of Object.entries(entries)) {
    map.set(path, encoder.encode(text))
  }
  return map
}

function testNormalizeSitePath(): void {
  assert.equal(normalizeSitePath(['js', '.', 'app.js']), 'js/app.js')
  assert.equal(normalizeSitePath(['js', '..', 'app.js']), 'app.js')
  assert.equal(normalizeSitePath(['..', 'app.js']), undefined)
  assert.equal(normalizeSitePath(['a', 'b', '..', '..']), '')
}

function testResolveSiteRef(): void {
  assert.equal(resolveSiteRef('index.html', 'app.js'), 'app.js')
  assert.equal(resolveSiteRef('index.html', './app.js'), 'app.js')
  assert.equal(resolveSiteRef('js/a.js', '../styles.css'), 'styles.css')
  assert.equal(resolveSiteRef('js/a.js', '/root.js'), 'root.js')
  assert.equal(resolveSiteRef('index.html', '../outside.js'), undefined)
  assert.equal(resolveSiteRef('index.html', 'https://cdn.example/x.js'), undefined)
  assert.equal(resolveSiteRef('index.html', '#anchor'), undefined)
}

function testMissingEntryReturnsUndefined(): void {
  assert.equal(buildSiteDocument({ resources: resources({ 'other.html': 'x' }) }), undefined)
  assert.ok(EMPTY_SITE_DOCUMENT.includes('<html'))
}

function testSameDirectoryScript(): void {
  const doc = buildSiteDocument({
    resources: resources({
      'index.html': '<html><head></head><body><script src="app.js"></script></body></html>',
      'app.js': 'console.log(1)',
    }),
  })!
  assert.ok(doc.includes('<script src="data:text/javascript;base64,'))
}

function testSubdirectoryAndRootRelative(): void {
  const doc = buildSiteDocument({
    resources: resources({
      'index.html': '<img src="images/logo.png"><link rel="stylesheet" href="/css/site.css">',
      'images/logo.png': 'png',
      'css/site.css': 'body{}',
    }),
  })!
  assert.ok(doc.includes('<img src="data:image/png;base64,'))
  assert.ok(doc.includes('href="data:text/css;base64,'))
}

function testEscapeNotRewritten(): void {
  const html = '<script src="../outside.js"></script>'
  const doc = buildSiteDocument({ resources: resources({ 'index.html': html }) })!
  assert.ok(doc.includes('../outside.js'))
}

function testCssUrlRewrite(): void {
  const doc = buildSiteDocument({
    resources: resources({
      'index.html':
        '<html><head><link rel="stylesheet" href="site.css"></head><body style="background: url(bg.png)"></body></html>',
      'site.css': 'body { background: url("img/a.png"); } @import "more.css";',
      'img/a.png': 'a',
      'more.css': 'p{}',
      'bg.png': 'b',
    }),
  })!
  assert.ok(doc.includes('data:image/png;base64,'))
  // CSS 内引用按 CSS 文件所在目录解析并被重写
  assert.ok(!doc.includes('url("img/a.png")'))
  // style 属性内的 url() 同样重写
  assert.ok(!doc.includes('url(bg.png'))
}

function testSrcsetRewrite(): void {
  const doc = buildSiteDocument({
    resources: resources({
      'index.html': '<img srcset="a.png 1x, b.png 2x">',
      'a.png': 'a',
      'b.png': 'b',
    }),
  })!
  assert.ok(doc.includes('data:image/png;base64,'))
  assert.ok(doc.includes(' 2x'))
}

function testFetchShimInjected(): void {
  const doc = buildSiteDocument({
    resources: resources({
      'index.html': '<html><head></head><body></body></html>',
      'data.json': '{"ok":true}',
    }),
  })!
  assert.ok(doc.includes('data-instant-site-shim'))
  assert.ok(doc.includes('data.json'))
  // shim 注入在 head 最前
  const headIndex = doc.indexOf('<head>')
  const shimIndex = doc.indexOf('data-instant-site-shim')
  assert.ok(headIndex >= 0 && shimIndex > headIndex)
}

function testMime(): void {
  assert.equal(siteMimeForPath('a.js'), 'text/javascript')
  assert.equal(siteMimeForPath('a.CSS'), 'text/css')
  assert.equal(siteMimeForPath('a.woff2'), 'font/woff2')
  assert.equal(siteMimeForPath('a.bin'), 'application/octet-stream')
}

function main(): void {
  testNormalizeSitePath()
  testResolveSiteRef()
  testMissingEntryReturnsUndefined()
  testSameDirectoryScript()
  testSubdirectoryAndRootRelative()
  testEscapeNotRewritten()
  testCssUrlRewrite()
  testSrcsetRewrite()
  testFetchShimInjected()
  testMime()
  console.log('generated-app-site-html.test: all passed')
}

main()
