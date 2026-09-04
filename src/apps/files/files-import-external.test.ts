/**
 * 外部文件导入单测：文件名净化、导入树拍平（纯逻辑）；
 * 以及顶层目标文件夹圆饼集成（created 立即广播、登记/撤掉、子树字节定标）。
 * 运行：node --experimental-strip-types src/apps/files/files-import-external.test.ts
 */
import 'fake-indexeddb/auto'
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import {
  importExternalNodes,
  planExternalImport,
  sanitizeSystemFileName,
  type ExternalImportNode,
} from './files-import-external.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  invalidateFilesVfsPathCaches,
  resolveNodeByAbsolutePath,
} from './files-vfs.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import {
  getFilesWriteProgressSnapshot,
  resetFilesWriteProgressForTests,
  subscribeFilesWriteProgress,
} from './files-write-progress.ts'

function file(name: string, size = 3): File {
  return new File([new Uint8Array(size)], name)
}

function testSanitize(): void {
  assert.equal(sanitizeSystemFileName('a/b:c.txt'), 'a-b-c.txt')
  assert.equal(sanitizeSystemFileName('  hello  '), 'hello')
  assert.equal(sanitizeSystemFileName('...'), '...')
  assert.equal(sanitizeSystemFileName('..'), '未命名')
  assert.equal(sanitizeSystemFileName('.'), '未命名')
  assert.equal(sanitizeSystemFileName(''), '未命名')
  assert.equal(sanitizeSystemFileName('   '), '未命名')
  assert.equal(sanitizeSystemFileName('a\u0000b'), 'a-b')
  assert.equal(sanitizeSystemFileName('x'.repeat(300)).length, 255)
  assert.equal(sanitizeSystemFileName('a//b'), 'a-b')
  console.log('ok: sanitizeSystemFileName')
}

function testPlanFlatFiles(): void {
  const nodes: ExternalImportNode[] = [
    { name: 'a.txt', kind: 'file', file: file('a.txt') },
    { name: 'b.txt', kind: 'file', file: file('b.txt', 5) },
  ]
  const steps = planExternalImport(nodes)
  assert.deepEqual(steps, [
    { op: 'write', name: 'a.txt', file: nodes[0].file, byteSize: 3 },
    { op: 'write', name: 'b.txt', file: nodes[1].file, byteSize: 5 },
  ])
  console.log('ok: plan flat files')
}

function testPlanFolderTree(): void {
  const nodes: ExternalImportNode[] = [
    {
      name: 'folder',
      kind: 'folder',
      children: [
        { name: 'inner.txt', kind: 'file', file: file('inner.txt', 7) },
        {
          name: 'sub',
          kind: 'folder',
          children: [{ name: 'deep.md', kind: 'file', file: file('deep.md', 9) }],
        },
      ],
    },
    { name: 'root.txt', kind: 'file', file: file('root.txt', 1) },
  ]
  const steps = planExternalImport(nodes)
  assert.deepEqual(steps.map((step) => step.op), ['mkdir', 'write', 'mkdir', 'write', 'write'])
  assert.deepEqual(steps[0], { op: 'mkdir', name: 'folder' })
  assert.equal((steps[1] as { name: string }).name, 'inner.txt')
  assert.deepEqual(steps[2], { op: 'mkdir', name: 'sub' })
  assert.equal((steps[4] as { name: string }).name, 'root.txt')
  // 非法字符在 plan 时净化
  const bad = planExternalImport([{ name: 'a/b', kind: 'file', file: file('x') }])
  assert.equal((bad[0] as { name: string }).name, 'a-b')
  console.log('ok: plan folder tree')
}

function testPlanSkipsEmptyNodes(): void {
  const nodes: ExternalImportNode[] = [
    { name: 'no-file', kind: 'file' },
    { name: 'empty-dir', kind: 'folder', children: [] },
  ]
  const steps = planExternalImport(nodes)
  assert.deepEqual(steps, [{ op: 'mkdir', name: 'empty-dir' }])
  console.log('ok: plan skips empty nodes')
}

/** 顶层目标文件夹：created 绕过批量立即广播；登记圆饼（总量=子树字节），子树走完撤掉 */
async function testImportTopLevelFolderPie(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
  // 触发用户特殊文件夹自动创建，保持与其它套件一致的基线
  await resolveNodeByAbsolutePath('/user/.warmup-probe')
  invalidateFilesVfsPathCaches()
  resetFilesWriteProgressForTests()

  const nodes: ExternalImportNode[] = [
    {
      name: 'imported-top',
      kind: 'folder',
      children: [
        { name: 'a.txt', kind: 'file', file: file('a.txt', 3000) },
        {
          name: 'nested',
          kind: 'folder',
          children: [{ name: 'b.txt', kind: 'file', file: file('b.txt', 2000) }],
        },
      ],
    },
    { name: 'loose.txt', kind: 'file', file: file('loose.txt', 100) },
  ]

  // 快照里的 entry 是会被原地更新的同一引用，必须在通知当下抓数值
  let sawTopFillFraction: number | undefined
  const unsubscribe = subscribeFilesWriteProgress(() => {
    if (sawTopFillFraction !== undefined) return
    const snapshot = getFilesWriteProgressSnapshot()
    // 顶层目标文件夹登记发生在任何文件流写之前：首个通知里只有它一条
    if (snapshot.size === 1) sawTopFillFraction = [...snapshot.values()][0]?.fraction
  })
  let batchEvents = 0
  const onVfsChanged = () => {
    batchEvents += 1
  }
  window.addEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
  let result: { fileCount: number; byteCount: number }
  try {
    result = await importExternalNodes({
      nodes,
      dest: { destLocationId: 'local', destParentId: undefined },
    })
  } finally {
    unsubscribe()
    window.removeEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
  }
  assert.ok(result.fileCount >= 3, `应导入 3 个文件，实际 ${result.fileCount}`)
  assert.equal(sawTopFillFraction, 0, '导入期间应登记顶层目标文件夹的圆饼，登记时从 0 起步')
  assert.equal(getFilesWriteProgressSnapshot().size, 0, '导入结束后登记应全部撤掉')
  assert.ok(batchEvents > 0, '顶层文件夹的 created 应绕过批量合并立即广播')
  const top = await resolveNodeByAbsolutePath('/user/imported-top', { follow: false })
  assert.ok(top?.kind === 'folder', '顶层目标文件夹应已落盘')
  const nested = await resolveNodeByAbsolutePath('/user/imported-top/nested/b.txt', { follow: false })
  assert.ok(nested?.kind === 'file', '嵌套子文件应已写入')
  console.log('ok: import top-level folder registers pie and broadcasts immediately')
}

testSanitize()
testPlanFlatFiles()
testPlanFolderTree()
testPlanSkipsEmptyNodes()
await testImportTopLevelFolderPie()
console.log('files-import-external tests passed')
