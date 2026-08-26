/**
 * 重名冲突决策单测（纯函数，无 IO）：
 * - 可替换判定（类型一致且可写）
 * - 批级决策器：逐个询问 / 应用到全部记忆 / 替换降级重问 / 取消不记忆
 * 运行：node --experimental-strip-types src/apps/files/files-conflict.test.ts
 */
import assert from 'node:assert/strict'
import {
  createFilesConflictResolver,
  filesConflictAllowsReplace,
} from './files-conflict.ts'

function testAllowsReplace(): void {
  assert.equal(
    filesConflictAllowsReplace({ name: 'a.txt', kind: 'file', existingKind: 'file', existingWritable: true }),
    true,
  )
  // 类型不符（文件 vs 文件夹）不可替换
  assert.equal(
    filesConflictAllowsReplace({ name: 'a', kind: 'file', existingKind: 'folder', existingWritable: true }),
    false,
  )
  // 只读目标不可替换
  assert.equal(
    filesConflictAllowsReplace({ name: 'a.txt', kind: 'file', existingKind: 'file', existingWritable: false }),
    false,
  )
  // 目标类型未知时保守处理
  assert.equal(filesConflictAllowsReplace({ name: 'a.txt', kind: 'file' }), false)
  console.log('ok: allows-replace matrix')
}

async function testAsksEachWithoutApplyAll(): Promise<void> {
  const asked: string[] = []
  const resolve = createFilesConflictResolver(async (conflict) => {
    asked.push(conflict.name)
    return { choice: 'rename' }
  })
  assert.equal(await resolve({ name: 'one', kind: 'file', existingKind: 'file' }), 'rename')
  assert.equal(await resolve({ name: 'two', kind: 'file', existingKind: 'file' }), 'rename')
  assert.deepEqual(asked, ['one', 'two'])
  console.log('ok: asks each conflict without apply-to-all')
}

async function testApplyToAllRemembersChoice(): Promise<void> {
  let askCount = 0
  const resolve = createFilesConflictResolver(async () => {
    askCount += 1
    return { choice: 'skip', applyToAll: true }
  })
  assert.equal(await resolve({ name: 'a', kind: 'file', existingKind: 'file' }), 'skip')
  assert.equal(askCount, 1)
  for (const name of ['b', 'c']) {
    assert.equal(await resolve({ name, kind: 'file', existingKind: 'file' }), 'skip')
  }
  assert.equal(askCount, 1)
  console.log('ok: apply-to-all remembers skip')
}

async function testRememberedReplaceDowngradesToAskWhenUnreplaceable(): Promise<void> {
  const asked: string[] = []
  const resolve = createFilesConflictResolver(async (conflict) => {
    asked.push(conflict.name)
    return { choice: 'replace', applyToAll: true }
  })
  assert.equal(
    await resolve({ name: 'ok.txt', kind: 'file', existingKind: 'file', existingWritable: true }),
    'replace',
  )
  // 记住了「替换」，后续可替换的不再询问
  assert.equal(asked.length, 1)
  // 不可替换（同名是文件夹）：回退为重新询问这一个
  assert.equal(await resolve({ name: 'dir', kind: 'file', existingKind: 'folder' }), 'replace')
  assert.deepEqual(asked, ['ok.txt', 'dir'])
  console.log('ok: remembered replace re-asks unreplaceable conflicts')
}

async function testCancelDoesNotStick(): Promise<void> {
  let askCount = 0
  const resolve = createFilesConflictResolver(async () => {
    askCount += 1
    return undefined
  })
  assert.equal(await resolve({ name: 'x', kind: 'file', existingKind: 'file' }), undefined)
  assert.equal(await resolve({ name: 'y', kind: 'file', existingKind: 'file' }), undefined)
  assert.equal(askCount, 2)
  console.log('ok: cancel is not remembered')
}

async function main(): Promise<void> {
  testAllowsReplace()
  await testAsksEachWithoutApplyAll()
  await testApplyToAllRemembersChoice()
  await testRememberedReplaceDowngradesToAskWhenUnreplaceable()
  await testCancelDoesNotStick()
  console.log('files-conflict tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
