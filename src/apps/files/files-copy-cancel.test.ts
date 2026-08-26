/**
 * 文件长操作协作取消（AbortSignal）单测：
 * - copyNodeTo：开工前已 abort → 目的不创建任何节点
 * - copyNodeTo：树内文件间取消 → 半成品目的子树整体清理、源完好
 * - emptyTrash：根间取消 → 当前根完成后停下，剩余根不动
 * - runFilesOpWithProgress：任务内 AbortError 统一转成 FilesOpCancelledError 哨兵
 * 运行：node --experimental-strip-types src/apps/files/files-copy-cancel.test.ts
 */
import 'fake-indexeddb/auto'
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import { resetFilesDbForTests } from './files-storage.ts'
import {
  createTextFile,
  copyNodeTo,
  emptyTrash,
  invalidateFilesVfsPathCaches,
  listDirectory,
  mkdir,
  trashNode,
} from './files-vfs.ts'
import { FilesOpCancelledError, runFilesOpWithProgress } from './files-run-with-op-progress.ts'

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

/** 开工检查点：信号已中止则连目的根目录都不建 */
async function testCopyPreAbortedCreatesNothing(): Promise<void> {
  await resetState()
  const src = await mkdir({ locationId: 'local', parentId: undefined, name: 'src' })
  await createTextFile({ locationId: 'local', parentId: src.id, name: 'a.txt', text: 'a' })

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () =>
      copyNodeTo({
        sourceId: src.id,
        destLocationId: 'local',
        destParentId: undefined,
        signal: controller.signal,
      }),
    isAbortError,
  )
  // 根目录含系统预置特殊文件夹：只断言「src」仅剩源本身、未复制出副本
  const srcs = (await listDirectory('local', undefined)).filter((node) => node.name === 'src')
  assert.equal(srcs.length, 1)
  assert.equal(srcs[0]?.id, src.id)
  console.log('ok: pre-aborted copy creates nothing')
}

/**
 * 树内文件间取消：进度回调与复制链同步执行，
 * 在第 3 次 report（初始 0 + 根目录完成 + f0 完成）时正好处于 f1 开工前的检查点；
 * 单个文件的原子提交语义下 f0 已入库，但整个半成品目的子树随后被 best-effort 清理。
 */
async function testCopyMidTreeCancelCleansPartialDest(): Promise<void> {
  await resetState()
  const src = await mkdir({ locationId: 'local', parentId: undefined, name: 'big' })
  for (let i = 0; i < 3; i += 1) {
    await createTextFile({ locationId: 'local', parentId: src.id, name: `f${i}.txt`, text: `content-${i}` })
  }

  const controller = new AbortController()
  let reports = 0
  await assert.rejects(
    () =>
      copyNodeTo({
        sourceId: src.id,
        destLocationId: 'local',
        destParentId: undefined,
        signal: controller.signal,
        onProgress: () => {
          reports += 1
          if (reports >= 3) controller.abort()
        },
      }),
    isAbortError,
  )
  assert.ok(reports >= 3)

  const top = await listDirectory('local', undefined)
  const bigs = top.filter((node) => node.name === 'big')
  assert.equal(bigs.length, 1)
  assert.equal(bigs[0]?.id, src.id)
  const children = await listDirectory(src.locationId, src.id)
  assert.deepEqual(
    children.map((node) => node.name).sort(),
    ['f0.txt', 'f1.txt', 'f2.txt'],
  )
  console.log('ok: mid-tree cancel cleans partial destination, source intact')
}

/** 清空废纸篓在根之间停止：当前根删完才生效，其余根保持原状 */
async function testEmptyTrashCancelStopsBetweenRoots(): Promise<void> {
  await resetState()
  for (const name of ['r1.txt', 'r2.txt', 'r3.txt']) {
    const file = await createTextFile({ locationId: 'local', parentId: undefined, name, text: name })
    await trashNode(file.id)
  }
  assert.equal((await listDirectory('trash', undefined)).length, 3)

  const controller = new AbortController()
  await assert.rejects(
    () =>
      emptyTrash({
        signal: controller.signal,
        // 第一个报告「有实际工作量推进」的回调意味着第一个根已删完
        onProgress: (progress) => {
          if (progress.done > 0) controller.abort()
        },
      }),
    isAbortError,
  )
  const remaining = (await listDirectory('trash', undefined)).map((node) => node.name).sort()
  assert.deepEqual(remaining, ['r2.txt', 'r3.txt'])
  console.log('ok: emptyTrash cancel stops between roots')
}

/** 任务内任意检查点抛出的 AbortError 由 runner 归一为哨兵，收尾时清掉进度 UI */
async function testRunnerConvertsAbortToSentinel(): Promise<void> {
  const controller = new AbortController()
  const uiStates: unknown[] = []
  await assert.rejects(
    () =>
      runFilesOpWithProgress({
        kind: 'paste',
        totalWork: 10,
        onUiChange: (state) => {
          uiStates.push(state)
        },
        signal: controller.signal,
        cancel: () => undefined,
        task: async (report, signal) => {
          report({ done: 5, total: 10 })
          controller.abort()
          signal?.throwIfAborted?.()
          return 1
        },
      }),
    FilesOpCancelledError,
  )
  // finally 清尾：无论取消与否，最后一次 onUiChange 必须把进度条收走
  assert.equal(uiStates[uiStates.length - 1], undefined)
  console.log('ok: runner converts abort into FilesOpCancelledError')
}

async function main(): Promise<void> {
  await testCopyPreAbortedCreatesNothing()
  await testCopyMidTreeCancelCleansPartialDest()
  await testEmptyTrashCancelStopsBetweenRoots()
  await testRunnerConvertsAbortToSentinel()
  console.log('files-copy-cancel: all tests passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
