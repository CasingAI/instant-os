/**
 * 注册表 JSON 路径工具单测。
 * 运行：node --experimental-strip-types src/apps/registry/registry-json-path.test.ts
 */
import assert from 'node:assert/strict'
import {
  formatNodeForEditor,
  getAtPath,
  isJsonContainer,
  jsonKindLabel,
  jsonNodeKind,
  jsonOpenMode,
  listJsonChildren,
  longestValidPrefix,
  parseEditorDraft,
  parseJsonValue,
  pathTitle,
  setAtPath,
  summarizeJson,
} from './registry-json-path.ts'

function testParseAndKind(): void {
  assert.deepEqual(parseJsonValue('{"a":1}'), { ok: true, value: { a: 1 } })
  assert.equal(parseJsonValue('{').ok, false)
  assert.equal(isJsonContainer({ a: 1 }), true)
  assert.equal(isJsonContainer([1]), true)
  assert.equal(isJsonContainer(null), false)
  assert.equal(isJsonContainer('x'), false)
  assert.equal(jsonNodeKind({}), 'object')
  assert.equal(jsonNodeKind([]), 'array')
  assert.equal(jsonNodeKind('hi'), 'string')
  assert.equal(jsonNodeKind(3), 'number')
  assert.equal(jsonNodeKind(true), 'boolean')
  assert.equal(jsonNodeKind(null), 'null')
  assert.equal(jsonNodeKind(undefined), 'invalid')
  assert.equal(jsonKindLabel('array'), '数组')
}

function testOpenMode(): void {
  assert.equal(jsonOpenMode('hello', 'text'), 'edit')
  assert.equal(jsonOpenMode('hello', 'untyped'), 'edit')
  assert.equal(jsonOpenMode('42', 'json'), 'edit')
  assert.equal(jsonOpenMode('"hi"', 'json'), 'edit')
  assert.equal(jsonOpenMode('{', 'json'), 'edit')
  assert.equal(jsonOpenMode('{"a":1}', 'json'), 'browse')
  assert.equal(jsonOpenMode('[1,2]', 'json'), 'browse')
}

function testGetSetPath(): void {
  const root = {
    articles: [
      { id: 'a1', title: '今日头条', body: '……' },
      { id: 'a2', title: '次条' },
    ],
    count: 2,
    flag: null,
  }

  assert.deepEqual(getAtPath(root, []), root)
  assert.equal(getAtPath(root, ['count']), 2)
  assert.equal(getAtPath(root, ['flag']), null)
  assert.equal(getAtPath(root, ['articles', '0', 'title']), '今日头条')
  assert.equal(getAtPath(root, ['articles', '9']), undefined)
  assert.equal(getAtPath(root, ['articles', '01', 'title']), undefined)
  assert.equal(getAtPath(root, ['missing']), undefined)
  assert.equal(getAtPath(root, ['count', 'nope']), undefined)

  const renamed = setAtPath(root, ['articles', '0', 'title'], '改标题')
  assert.equal(getAtPath(renamed, ['articles', '0', 'title']), '改标题')
  assert.equal(getAtPath(root, ['articles', '0', 'title']), '今日头条', '原树不可变')
  assert.equal(getAtPath(renamed, ['articles', '1', 'title']), '次条')

  const replaced = setAtPath(root, ['articles'], [])
  assert.deepEqual(getAtPath(replaced, ['articles']), [])

  const whole = setAtPath(root, [], { ok: true })
  assert.deepEqual(whole, { ok: true })

  assert.equal(setAtPath(root, ['nope'], 1), undefined)
  assert.equal(setAtPath(root, ['articles', '9', 'title'], 'x'), undefined)
  assert.equal(setAtPath('leaf', ['a'], 1), undefined)
}

function testLongestValidPrefix(): void {
  const root = { cities: [{ name: '北京' }] }
  assert.deepEqual(longestValidPrefix(root, []), [])
  assert.deepEqual(longestValidPrefix(root, ['cities', '0', 'name']), ['cities', '0', 'name'])
  assert.deepEqual(longestValidPrefix(root, ['cities', '0', 'missing']), ['cities', '0'])
  assert.deepEqual(longestValidPrefix(root, ['cities', '3', 'name']), ['cities'])
  assert.deepEqual(longestValidPrefix(root, ['nope', 'x']), [])
  assert.deepEqual(longestValidPrefix({ a: null }, ['a', 'b']), ['a'])
}

function testListAndSummarize(): void {
  assert.equal(summarizeJson({ a: 1, b: 2 }), '{2 个键}')
  assert.equal(summarizeJson([]), '[0 项]')
  assert.equal(summarizeJson('short'), 'short')
  assert.equal(summarizeJson(true), 'true')
  assert.equal(summarizeJson(null), 'null')

  const children = listJsonChildren({
    cities: [{ id: 'beijing', name: '北京' }],
    active: 'beijing',
  })
  assert.equal(children.length, 2)
  assert.equal(children[0]?.key, 'cities')
  assert.equal(children[0]?.kind, 'array')
  assert.equal(children[0]?.summary, '[1 项]')
  assert.equal(children[1]?.kind, 'string')
  assert.equal(children[1]?.summary, 'beijing')

  const items = listJsonChildren([
    { id: 'a1', title: '今日头条' },
    { name: '上海' },
    3,
  ])
  assert.equal(items[0]?.label, '[0]')
  assert.equal(items[0]?.summary, '今日头条')
  assert.equal(items[1]?.summary, '上海')
  assert.equal(items[2]?.summary, '3')
}

function testPathTitle(): void {
  const root = { articles: [{ title: 'A' }] }
  assert.equal(pathTitle('articles', [], root), 'articles')
  assert.equal(pathTitle('articles', ['articles'], root), 'articles')
  assert.equal(pathTitle('store', ['articles', '0'], root), '[0]')
  assert.equal(pathTitle('store', ['articles', '0', 'title'], root), 'title')
}

function testEditorRoundTrip(): void {
  assert.equal(formatNodeForEditor('hello'), 'hello')
  assert.equal(formatNodeForEditor({ a: 1 }), '{\n  "a": 1\n}')
  assert.equal(formatNodeForEditor(true), 'true')

  assert.deepEqual(parseEditorDraft('string', '  hi '), { ok: true, value: '  hi ' })
  assert.deepEqual(parseEditorDraft('number', '3.5'), { ok: true, value: 3.5 })
  assert.equal(parseEditorDraft('number', 'nope').ok, false)
  assert.deepEqual(parseEditorDraft('boolean', ' true '), { ok: true, value: true })
  assert.equal(parseEditorDraft('boolean', 'yes').ok, false)
  assert.deepEqual(parseEditorDraft('null', 'null'), { ok: true, value: null })
  assert.deepEqual(parseEditorDraft('array', '[1, 2]'), { ok: true, value: [1, 2] })
  assert.equal(parseEditorDraft('object', '{').ok, false)
}

async function main(): Promise<void> {
  const cases = [
    testParseAndKind,
    testOpenMode,
    testGetSetPath,
    testLongestValidPrefix,
    testListAndSummarize,
    testPathTitle,
    testEditorRoundTrip,
  ]
  for (const test of cases) {
    test()
    console.log(`ok: ${test.name}`)
  }
  console.log('registry-json-path: all passed')
}

await main()
