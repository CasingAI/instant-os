/**
 * VFS 文件名搜索单测。
 * 运行：node --experimental-strip-types src/apps/files/vfs-name-search.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  filesCreateAttachment,
  filesCreateBinary,
  filesCreateText,
  filesMkdir,
  filesRemove,
  filesStat,
} from './files-api.ts'
import { defaultFilesNodeAttributes, FILES_ATTACH_SEGMENT, type FilesNode } from './files-types.ts'
import { listSubtreeFiles, resolveNodeByAbsolutePath } from './files-vfs.ts'
import {
  filterVfsNameSearchIndex,
  getCachedVfsNameSearchIndex,
  invalidateVfsNameSearchIndexCache,
  isVfsNameSearchIndexStale,
  markVfsNameSearchIndexStale,
  scanAndCacheVfsNameSearchIndex,
  scanNamesViaLister,
  scanVfsNameSearchIndex,
  searchNamesViaLister,
  searchVfsNames,
} from './vfs-name-search.ts'

const ROOT = '/user/vfs-name-search-test'

/** 本地卷搜索根的 folderId */
async function rootFolderId(): Promise<string | undefined> {
  const node = await resolveNodeByAbsolutePath(ROOT)
  assert.ok(node, '搜索根目录不存在')
  return node.id
}

async function resetRoot(): Promise<void> {
  const existing = await filesStat(ROOT)
  if (existing !== undefined) {
    await filesRemove(ROOT)
  }
  await filesMkdir(ROOT)
}

async function testLocalVolumeBasics(): Promise<void> {
  await resetRoot()
  await filesMkdir(`${ROOT}/docs`)
  await filesMkdir(`${ROOT}/docs/nested`)
  await filesCreateText(`${ROOT}/docs/nested/Report-Draft.txt`, 'hello\n')
  await filesCreateText(`${ROOT}/docs/readme.md`, 'world\n')
  await filesCreateText(`${ROOT}/unrelated.bin`, 'x\n')

  const result = await searchVfsNames(
    { locationId: 'local', folderId: await rootFolderId() },
    'draft',
  )
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0]?.name, 'Report-Draft.txt')
  assert.equal(result.hits[0]?.kind, 'file')
  assert.equal(result.hits[0]?.parentPath, 'docs/nested')
  assert.ok(result.hits[0]?.absolutePath?.endsWith('/docs/nested/Report-Draft.txt'))
  assert.equal(result.truncated, false)
  assert.deepEqual(result.errors, [])

  // 大小写不敏感
  const upper = await searchVfsNames(
    { locationId: 'local', folderId: await rootFolderId() },
    'REPORT',
  )
  assert.equal(upper.hits.length, 1)

  // 命中文件夹
  const folders = await searchVfsNames(
    { locationId: 'local', folderId: await rootFolderId() },
    'doc',
  )
  assert.ok(folders.hits.some((hit) => hit.kind === 'folder' && hit.name === 'docs'))
  assert.ok(folders.hits.every((hit) => hit.name.toLowerCase().includes('doc')))

  // 无匹配
  const none = await searchVfsNames(
    { locationId: 'local', folderId: await rootFolderId() },
    '不存在的关键字',
  )
  assert.equal(none.hits.length, 0)

  // 空查询直接返回空
  const empty = await searchVfsNames(
    { locationId: 'local', folderId: await rootFolderId() },
    '   ',
  )
  assert.equal(empty.hits.length, 0)

  // 搜索根的直接子项 parentPath 为空串
  const top = await searchVfsNames(
    { locationId: 'local', folderId: await rootFolderId() },
    'unrelated',
  )
  assert.equal(top.hits[0]?.parentPath, '')
  console.log('ok: local volume basics')
}

async function testLocalVolumeSubtreeScope(): Promise<void> {
  await resetRoot()
  await filesMkdir(`${ROOT}/sub`)
  await filesCreateText(`${ROOT}/sub/needle.txt`, '')
  await filesCreateText(`${ROOT}/needle-outside-scope.txt`, '')

  // 搜索根为 ROOT/sub 时只看得到子树内的命中
  const subNode = await resolveNodeByAbsolutePath(`${ROOT}/sub`)
  assert.ok(subNode)
  const scoped = await searchVfsNames({ locationId: 'local', folderId: subNode.id }, 'needle')
  assert.equal(scoped.hits.length, 1)
  assert.equal(scoped.hits[0]?.parentPath, '')
  console.log('ok: local volume subtree scope')
}

async function testLocalVolumeLimit(): Promise<void> {
  await resetRoot()
  for (let index = 0; index < 5; index += 1) {
    await filesCreateText(`${ROOT}/bulk-${index}.txt`, '')
  }
  const result = await searchVfsNames(
    { locationId: 'local', folderId: await rootFolderId() },
    'bulk-',
    { limit: 3 },
  )
  assert.equal(result.hits.length, 3)
  assert.equal(result.truncated, true)
  console.log('ok: local volume limit')
}

async function testLocalVolumeAbort(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/abort-case.txt`, '')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    searchVfsNames({ locationId: 'local', folderId: await rootFolderId() }, 'abort', {
      signal: controller.signal,
    }),
    /AbortError|取消/,
  )
  console.log('ok: local volume abort')
}

/** 内存目录树（模拟挂载 / 镜像卷的逐层列举语义） */
type FakeDir = { folderId: string | undefined; children: FakeNode[] }
type FakeNode = {
  id: string
  kind: 'file' | 'folder'
  name: string
  byteSize?: number
  updatedAt?: number
}

function fakeNode(node: FakeNode): FilesNode {
  return {
    id: node.id,
    locationId: 'local',
    parentId: undefined,
    name: node.name,
    kind: node.kind,
    mimeType: undefined,
    byteSize: node.byteSize ?? 0,
    createdAt: node.updatedAt ?? 0,
    updatedAt: node.updatedAt ?? 0,
    attributes: defaultFilesNodeAttributes('local'),
  }
}

function makeLister(dirs: FakeDir[]) {
  return async (folderId: string | undefined): Promise<FilesNode[]> => {
    const dir = dirs.find((candidate) => candidate.folderId === folderId)
    if (!dir) throw new Error(`目录不存在: ${folderId}`)
    return dir.children.map(fakeNode)
  }
}

const FAKE_TREE: FakeDir[] = [
  {
    folderId: undefined,
    children: [
      { id: 'd1', kind: 'folder', name: '项目' },
      { id: 'f1', kind: 'file', name: '顶层的草稿.txt', byteSize: 12, updatedAt: 100 },
    ],
  },
  {
    folderId: 'd1',
    children: [
      { id: 'd2', kind: 'folder', name: 'archive' },
      { id: 'f2', kind: 'file', name: '草稿-v2.txt', byteSize: 34, updatedAt: 200 },
    ],
  },
  {
    folderId: 'd2',
    children: [{ id: 'f3', kind: 'file', name: 'old-draft.log', byteSize: 56, updatedAt: 300 }],
  },
]

async function testListerBasics(): Promise<void> {
  const result = await searchNamesViaLister(makeLister(FAKE_TREE), undefined, '草稿')
  assert.equal(result.hits.length, 2)
  // 文件夹优先，同类按 zh-Hans 拼音序（草 c < 顶 d）
  assert.equal(result.hits[0]?.name, '草稿-v2.txt')
  assert.equal(result.hits[0]?.parentPath, '项目')
  assert.equal(result.hits[1]?.name, '顶层的草稿.txt')
  assert.equal(result.hits[1]?.parentPath, '')
  assert.equal(result.hits[0]?.byteSize, 34)
  assert.equal(result.truncated, false)
  assert.deepEqual(result.errors, [])
  console.log('ok: lister basics')
}

async function testListerDeepNesting(): Promise<void> {
  const result = await searchNamesViaLister(makeLister(FAKE_TREE), undefined, 'draft')
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0]?.name, 'old-draft.log')
  assert.equal(result.hits[0]?.parentPath, '项目/archive')
  console.log('ok: lister deep nesting')
}

async function testListerLimitAndTruncation(): Promise<void> {
  const manyDirs: FakeDir[] = [
    { folderId: undefined, children: [{ id: 'p', kind: 'folder', name: 'p' }] },
  ]
  for (let index = 0; index < 5; index += 1) {
    manyDirs.push({
      folderId: `p-${index}`,
      children: [{ id: `f-${index}`, kind: 'file', name: `hit-${index}.txt` }],
    })
    manyDirs[0]?.children.push({ id: `p-${index}`, kind: 'folder', name: `p-${index}` })
  }
  const result = await searchNamesViaLister(makeLister(manyDirs), undefined, 'hit-', {
    limit: 2,
  })
  assert.equal(result.hits.length, 2)
  assert.equal(result.truncated, true)
  console.log('ok: lister limit and truncation')
}

async function testListerErrorTolerance(): Promise<void> {
  const dirs: FakeDir[] = [
    {
      folderId: undefined,
      children: [
        { id: 'good', kind: 'folder', name: 'good' },
        { id: 'bad', kind: 'folder', name: 'bad' },
        { id: 'ok.txt', kind: 'file', name: 'ok.txt' },
      ],
    },
    { folderId: 'good', children: [{ id: 'g.txt', kind: 'file', name: 'needle.txt' }] },
    { folderId: 'bad', children: [] },
  ]
  const lister = async (folderId: string | undefined): Promise<FilesNode[]> => {
    if (folderId === 'bad') throw new Error('句柄已失效')
    return makeLister(dirs)(folderId)
  }
  const result = await searchNamesViaLister(lister, undefined, 'needle')
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0]?.name, 'needle.txt')
  assert.equal(result.errors.length, 1)
  assert.ok(result.errors[0]?.includes('句柄已失效'))
  console.log('ok: lister error tolerance')
}

async function testListerAbort(): Promise<void> {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    searchNamesViaLister(makeLister(FAKE_TREE), undefined, '草稿', {
      signal: controller.signal,
    }),
    /AbortError|取消/,
  )
  console.log('ok: lister abort')
}

async function testListerEmptyQuery(): Promise<void> {
  const result = await searchNamesViaLister(makeLister(FAKE_TREE), undefined, '  ')
  assert.deepEqual(result, { hits: [], truncated: false, errors: [] })
  console.log('ok: lister empty query')
}

/** scan+filter 组合与 searchVfsNames 在本地卷上逐字段等价 */
async function testScanFilterEquivalenceLocal(): Promise<void> {
  await resetRoot()
  await filesMkdir(`${ROOT}/docs`)
  await filesMkdir(`${ROOT}/docs/nested`)
  await filesCreateText(`${ROOT}/docs/nested/Report-Draft.txt`, 'hello\n')
  await filesCreateText(`${ROOT}/docs/readme.md`, 'world\n')
  await filesCreateText(`${ROOT}/unrelated.bin`, 'x\n')

  const root = { locationId: 'local', folderId: await rootFolderId() }
  for (const query of ['draft', 'DRAFT', 'doc', 'readme', '不存在']) {
    const direct = await searchVfsNames(root, query)
    const index = await scanVfsNameSearchIndex(root)
    assert.deepEqual(filterVfsNameSearchIndex(index, root, query), direct)
  }
  console.log('ok: scan+filter equals searchVfsNames (local volume)')
}

/** scan+filter 组合与 searchNamesViaLister 在注入内存树上逐字段等价 */
async function testScanFilterEquivalenceLister(): Promise<void> {
  for (const query of ['草稿', 'draft', '顶层的', '不存在']) {
    const direct = await searchNamesViaLister(makeLister(FAKE_TREE), undefined, query)
    const index = await scanNamesViaLister(makeLister(FAKE_TREE), undefined)
    assert.deepEqual(
      filterVfsNameSearchIndex(index, { locationId: 'local', folderId: undefined }, query),
      direct,
    )
  }
  console.log('ok: scan+filter equals searchNamesViaLister')
}

/** lister 路径 truncated 与本地卷语义对齐：只有出现第 limit+1 个命中才置位 */
async function testListerTruncatedSemantics(): Promise<void> {
  const dirs: FakeDir[] = [
    { folderId: undefined, children: [{ id: 'p', kind: 'folder', name: 'p' }] },
  ]
  for (let index = 0; index < 4; index += 1) {
    dirs.push({
      folderId: `p-${index}`,
      children: [{ id: `f-${index}`, kind: 'file', name: `hit-${index}.txt` }],
    })
    dirs[0]?.children.push({ id: `p-${index}`, kind: 'folder', name: `p-${index}` })
  }
  // 命中达 limit 之后仍会列举的无命中目录：旧实现在此误报 truncated
  dirs.push({ folderId: 'tail', children: [{ id: 'tail-empty', kind: 'folder', name: 'empty' }] })
  dirs[0]?.children.push({ id: 'tail', kind: 'folder', name: 'tail' })
  dirs.push({ folderId: 'tail-empty', children: [] })
  const lister = makeLister(dirs)

  const exact = await searchNamesViaLister(lister, undefined, 'hit-', { limit: 4 })
  assert.equal(exact.hits.length, 4)
  assert.equal(exact.truncated, false)

  const over = await searchNamesViaLister(lister, undefined, 'hit-', { limit: 3 })
  assert.equal(over.hits.length, 3)
  assert.equal(over.truncated, true)
  console.log('ok: lister truncated aligns with local semantics')
}

/** 子树索引缓存：读写 / 容量 2 淘汰 / stale 标记 / 显式失效 */
async function testNameSearchIndexCache(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/a.txt`, '')
  await filesMkdir(`${ROOT}/sub`)
  await filesCreateText(`${ROOT}/sub/b.txt`, '')

  const rootA = { locationId: 'local', folderId: await rootFolderId() }
  const indexA = await scanAndCacheVfsNameSearchIndex(rootA)
  assert.equal(getCachedVfsNameSearchIndex(rootA), indexA)
  assert.equal(isVfsNameSearchIndexStale(rootA), false)

  markVfsNameSearchIndexStale()
  assert.equal(isVfsNameSearchIndexStale(rootA), true)
  await scanAndCacheVfsNameSearchIndex(rootA)
  assert.equal(isVfsNameSearchIndexStale(rootA), false)
  // 重扫是 refresh 而非保留旧 index：缓存里换成了新对象
  assert.notEqual(getCachedVfsNameSearchIndex(rootA), indexA)

  const subNode = await resolveNodeByAbsolutePath(`${ROOT}/sub`)
  assert.ok(subNode)
  await scanAndCacheVfsNameSearchIndex({ locationId: 'local', folderId: subNode.id })
  await scanAndCacheVfsNameSearchIndex({ locationId: 'local', folderId: undefined })
  assert.equal(getCachedVfsNameSearchIndex(rootA), undefined)
  assert.ok(getCachedVfsNameSearchIndex({ locationId: 'local', folderId: subNode.id }))
  assert.ok(getCachedVfsNameSearchIndex({ locationId: 'local', folderId: undefined }))

  invalidateVfsNameSearchIndexCache()
  assert.equal(getCachedVfsNameSearchIndex({ locationId: 'local', folderId: undefined }), undefined)
  console.log('ok: name-search index cache (capacity/stale/invalidate)')
}

/** 附加（主文件下的内部数据）不进本地卷搜索索引：路径带 .attach 保留段，点开也解析不回节点 */
async function testLocalVolumeSkipsAttachments(): Promise<void> {
  await resetRoot()
  await filesCreateBinary(`${ROOT}/盘.img`, new Uint8Array([1, 1, 1, 1]).buffer)
  await filesCreateAttachment({
    mainFilePath: `${ROOT}/盘.img`,
    name: '盘-缓存',
    bytes: new Uint8Array([9]).buffer,
    tags: ['vm-disk-cache'],
  })
  const root = { locationId: 'local', folderId: await rootFolderId() }
  // 查附加名：不命中（附加不进索引）
  const byAttachName = await searchVfsNames(root, '盘-缓存')
  assert.equal(byAttachName.hits.length, 0)
  // 查主文件名：只有主文件命中，附加不额外出现
  const byMainName = await searchVfsNames(root, '盘')
  assert.equal(byMainName.hits.length, 1)
  assert.equal(byMainName.hits[0]?.name, '盘.img')
  // listSubtreeFiles 仍含附加（统计口径不变），但条目带 attachment 标记供消费方过滤
  const subtree = await listSubtreeFiles(ROOT)
  const attachEntry = subtree.find((entry) => entry.attachment)
  assert.ok(attachEntry, '子树枚举应保留附加条目（attachment 标记）')
  assert.equal(attachEntry.path, `盘.img/${FILES_ATTACH_SEGMENT}/盘-缓存`)
  assert.equal(subtree.find((entry) => entry.path === '盘.img')?.attachment, false)
  console.log('ok: local volume name search skips attachments')
}

async function testLocalVolumeSubtreeFilesContract(): Promise<void> {
  await resetRoot()
  await filesMkdir(`${ROOT}/a`)
  await filesCreateText(`${ROOT}/a/inner.txt`, '12345')
  await filesCreateText(`${ROOT}/top.bin`, 'x')

  const entries = await listSubtreeFiles(ROOT)
  const paths = entries.map((entry) => entry.path).sort()
  assert.deepEqual(paths, ['a/inner.txt', 'top.bin'])
  const inner = entries.find((entry) => entry.path === 'a/inner.txt')
  assert.equal(inner?.byteSize, 5)
  assert.ok((inner?.updatedAt ?? 0) > 0)
  assert.ok(inner?.absolutePath.endsWith('/a/inner.txt'))
  console.log('ok: listSubtreeFiles contract (file-info 共用入口)')
}

const tests = [
  testLocalVolumeBasics,
  testLocalVolumeSubtreeScope,
  testLocalVolumeLimit,
  testLocalVolumeAbort,
  testLocalVolumeSkipsAttachments,
  testScanFilterEquivalenceLocal,
  testScanFilterEquivalenceLister,
  testListerTruncatedSemantics,
  testNameSearchIndexCache,
  testLocalVolumeSubtreeFilesContract,
  testListerBasics,
  testListerDeepNesting,
  testListerLimitAndTruncation,
  testListerErrorTolerance,
  testListerAbort,
  testListerEmptyQuery,
]

for (const test of tests) {
  await test()
}
console.log(`vfs-name-search: ${tests.length} tests ok`)
