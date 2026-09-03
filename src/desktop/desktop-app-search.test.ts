/**
 * 桌面应用检索：目录、过滤排序、唤起键。
 * 运行：node --experimental-strip-types src/desktop/desktop-app-search.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildDesktopAppSearchCatalog,
  buildDesktopHelpPresetPrompt,
  desktopAppSearchSeedFromKey,
  filterDesktopAppSearchResults,
  isBuiltinAppSearchable,
  isDesktopAppSearchBlockedTarget,
  isDesktopAppSearchTriggerKey,
  listSearchableBuiltinApps,
  type DesktopAppSearchEntry,
} from './desktop-app-search.ts'

function testExcludedBuiltinsStayOutOfCatalog(): void {
  const apps = listSearchableBuiltinApps(false)
  const ids = apps.map((app) => app.id)
  assert.equal(ids.includes('page-devtools'), false)
  assert.equal(ids.includes('webview'), false)
  assert.equal(ids.includes('simulated-terminal'), false)
  assert.equal(ids.includes('files-op-progress'), false)
  assert.equal(ids.includes('speech'), false)
  assert.equal(isBuiltinAppSearchable('page-devtools'), false)
  assert.equal(isBuiltinAppSearchable('files-op-progress'), false)
  assert.equal(isBuiltinAppSearchable('speech', false), false)
  assert.equal(isBuiltinAppSearchable('speech', true), true)
  assert.ok(ids.includes('keychain'))
  assert.ok(ids.includes('registry'))
  assert.ok(ids.includes('task-manager'))
  console.log('ok: excluded builtins stay out of catalog')
}

function testSpeechAppearsWhenExperimental(): void {
  const ids = listSearchableBuiltinApps(true).map((app) => app.id)
  assert.ok(ids.includes('speech'))
  console.log('ok: speech appears when experimental')
}

function testCatalogMergesGeneratedAndExt(): void {
  const catalog = buildDesktopAppSearchCatalog({
    speechApp: false,
    installedApps: [{ id: 'gen:clock', name: '番茄钟' }],
    sessionExtApps: [{ id: 'ext:demo', name: '外链演示' }],
  })
  assert.equal(
    catalog.some((entry) => entry.id === 'gen:clock' && entry.kind === 'generated'),
    true,
  )
  assert.equal(
    catalog.some((entry) => entry.id === 'ext:demo' && entry.kind === 'ext'),
    true,
  )
  assert.equal(catalog.some((entry) => entry.id === 'speech'), false)
  console.log('ok: catalog merges generated and ext')
}

function sampleEntries(): DesktopAppSearchEntry[] {
  return [
    { id: 'weather', name: '天气', kind: 'builtin' },
    { id: 'settings', name: '系统设置', kind: 'builtin' },
    { id: 'keychain', name: '钥匙串', kind: 'builtin' },
    { id: 'gen:clock', name: '天气时钟', kind: 'generated' },
  ]
}

function testEmptyQueryKeepsCatalogOrder(): void {
  const entries = sampleEntries()
  assert.deepEqual(filterDesktopAppSearchResults(entries, '  '), entries)
  console.log('ok: empty query keeps catalog order')
}

function testPrefixRanksBeforeSubstring(): void {
  const results = filterDesktopAppSearchResults(sampleEntries(), '天气')
  assert.deepEqual(
    results.map((entry) => entry.id),
    ['weather', 'gen:clock'],
  )
  console.log('ok: prefix ranks before substring')
}

function testNameAndIdMatch(): void {
  const byName = filterDesktopAppSearchResults(sampleEntries(), '钥匙')
  assert.deepEqual(
    byName.map((entry) => entry.id),
    ['keychain'],
  )
  const byId = filterDesktopAppSearchResults(sampleEntries(), 'keychain')
  assert.deepEqual(
    byId.map((entry) => entry.id),
    ['keychain'],
  )
  const none = filterDesktopAppSearchResults(sampleEntries(), '不存在的应用')
  assert.deepEqual(none, [])
  console.log('ok: name and id match')
}

function testTriggerKeys(): void {
  const base = { metaKey: false, ctrlKey: false, altKey: false }
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: 'a' }), true)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: '天' }), true)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: '1' }), true)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: '/' }), true)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: ' ' }), false)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: 'Enter' }), false)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: 'Escape' }), false)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: 'ArrowLeft' }), false)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: 'a', metaKey: true }), false)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: 'a', ctrlKey: true }), false)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: 'Process' }), true)
  assert.equal(isDesktopAppSearchTriggerKey({ ...base, key: 'a', isComposing: true }), true)
  assert.equal(desktopAppSearchSeedFromKey({ ...base, key: 'k' }), 'k')
  assert.equal(desktopAppSearchSeedFromKey({ ...base, key: 'k', isComposing: true }), '')
  assert.equal(desktopAppSearchSeedFromKey({ ...base, key: 'Enter' }), '')
  console.log('ok: trigger keys')
}

function testBlockedTargets(): void {
  assert.equal(isDesktopAppSearchBlockedTarget(null), false)
  assert.equal(isDesktopAppSearchBlockedTarget({ tagName: 'DIV' }), false)
  assert.equal(isDesktopAppSearchBlockedTarget({ tagName: 'INPUT' }), true)
  assert.equal(isDesktopAppSearchBlockedTarget({ tagName: 'TEXTAREA' }), true)
  assert.equal(isDesktopAppSearchBlockedTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(
    isDesktopAppSearchBlockedTarget({
      tagName: 'DIV',
      closest: (selector: string) => (selector === '[aria-modal="true"]' ? { tagName: 'DIV' } : null),
    }),
    true,
  )
  console.log('ok: blocked targets')
}

function testHelpPresetPrompt(): void {
  assert.equal(buildDesktopHelpPresetPrompt(''), '')
  assert.equal(buildDesktopHelpPresetPrompt('   '), '')
  const prompt = buildDesktopHelpPresetPrompt('  清理存储空间 ')
  assert.ok(prompt.includes('清理存储空间'))
  assert.ok(prompt.startsWith('我想完成这件事'))
  assert.ok(!prompt.includes('  '))
  console.log('ok: help preset prompt')
}

testExcludedBuiltinsStayOutOfCatalog()
testSpeechAppearsWhenExperimental()
testCatalogMergesGeneratedAndExt()
testEmptyQueryKeepsCatalogOrder()
testPrefixRanksBeforeSubstring()
testNameAndIdMatch()
testTriggerKeys()
testBlockedTargets()
testHelpPresetPrompt()
console.log('desktop-app-search: all passed')
