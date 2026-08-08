/**
 * 外部文件导入纯逻辑单测：文件名净化、导入树拍平。
 * 运行：node --experimental-strip-types src/apps/files/files-import-external.test.ts
 */
import assert from 'node:assert/strict'
import {
  planExternalImport,
  sanitizeSystemFileName,
  type ExternalImportNode,
} from './files-import-external.ts'

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

testSanitize()
testPlanFlatFiles()
testPlanFolderTree()
testPlanSkipsEmptyNodes()
console.log('files-import-external tests passed')
