/**
 * 第八期：VFS 写时并发检查单测。
 * 运行：node --experimental-strip-types src/apps/files/files-write-revision-check.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  FilesContentRevisionMismatchError,
  resetFilesDbForTests,
} from './files-storage.ts'
import {
  filesCreateText,
  filesMkdir,
  filesReadText,
  filesRemove,
  filesRename,
  filesStat,
  filesUpsertBatch,
  filesWriteBinary,
  filesWriteBytesRange,
  filesWriteText,
} from './files-api.ts'
import { invalidateFilesVfsPathCaches } from './files-vfs.ts'

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function main(): Promise<void> {
  // 1. 匹配的期望版本 → 写入成功
  await resetState()
  {
    const created = await filesCreateText('/user/hello.txt', 'v1')
    assert.ok(created.contentRevisionId)
    const stat = await filesStat('/user/hello.txt')
    assert.equal(stat?.contentRevisionId, created.contentRevisionId)

    const written = await filesWriteText('/user/hello.txt', 'v2', {
      expectedContentRevisionId: created.contentRevisionId!,
    })
    assert.equal(await filesReadText('/user/hello.txt'), 'v2')
    assert.notEqual(written.contentRevisionId, created.contentRevisionId)

    // 拿到新版本再写一次也成功
    await filesWriteText('/user/hello.txt', 'v3', {
      expectedContentRevisionId: written.contentRevisionId,
    })
    assert.equal(await filesReadText('/user/hello.txt'), 'v3')
  }

  // 2. 过期的期望版本 → 抛 FilesContentRevisionMismatchError（带 path / expected / current）
  await resetState()
  {
    await filesCreateText('/user/conflict.txt', 'mine')
    const stale = (await filesStat('/user/conflict.txt'))!.contentRevisionId!
    // 外部写方先改了一手
    await filesWriteText('/user/conflict.txt', 'external')
    let caught: unknown
    try {
      await filesWriteText('/user/conflict.txt', 'stale-write', {
        expectedContentRevisionId: stale,
      })
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof FilesContentRevisionMismatchError, '应抛版本不匹配错误')
    if (!(caught instanceof FilesContentRevisionMismatchError)) return
    assert.equal(caught.path, '/user/conflict.txt')
    assert.equal(caught.expected, stale)
    const current = (await filesStat('/user/conflict.txt'))!.contentRevisionId
    assert.equal(caught.current, current)
    // 内容未被过期写入覆盖
    assert.equal(await filesReadText('/user/conflict.txt'), 'external')
    // 错误信息中文可读，含路径与两个版本
    assert.ok(caught.message.includes('/user/conflict.txt'))
    assert.ok(caught.message.includes(stale))
    assert.ok(caught.message.includes('请重读后重试'))

    // 重读后用新版本再写成功
    await filesWriteText('/user/conflict.txt', 'after-reread', {
      expectedContentRevisionId: current,
    })
    assert.equal(await filesReadText('/user/conflict.txt'), 'after-reread')
  }

  // 3. 不传 options → 盲写通过（行为与旧一致）
  await resetState()
  {
    await filesCreateText('/user/blind.txt', 'a')
    await filesWriteText('/user/blind.txt', 'b')
    assert.equal(await filesReadText('/user/blind.txt'), 'b')
  }

  // 4. 二进制与范围写同样覆盖
  await resetState()
  {
    const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer
    const created = await filesCreateText('/user/blob.bin', '')
    await filesWriteBinary('/user/blob.bin', enc('hello'), {
      expectedContentRevisionId: created.contentRevisionId,
    })
    assert.equal(await filesReadText('/user/blob.bin'), 'hello')

    const rev = (await filesStat('/user/blob.bin')).contentRevisionId!
    let caught: unknown
    try {
      await filesWriteBytesRange('/user/blob.bin', 0, enc('HELLO'), {
        expectedContentRevisionId: 'not-the-current-revision',
      })
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof FilesContentRevisionMismatchError)

    // 正确版本的范围写成功；盲写亦通过
    await filesWriteBytesRange('/user/blob.bin', 0, enc('HE'), { expectedContentRevisionId: rev })
    await filesWriteBytesRange('/user/blob.bin', 5, enc('!'))
    assert.equal(await filesReadText('/user/blob.bin'), 'HEllo!')
  }

  // 5. filesUpsertBatch：任一条期望不等 → 整批拒绝、无任何文件写入
  await resetState()
  {
    await filesCreateText('/user/batch-a.txt', 'a0')
    const staleA = (await filesStat('/user/batch-a.txt')).contentRevisionId!
    await filesCreateText('/user/batch-b.txt', 'b0')
    const revB = (await filesStat('/user/batch-b.txt')).contentRevisionId!
    await filesWriteText('/user/batch-a.txt', 'a1') // 外部把 a 改了

    let caught: unknown
    try {
      await filesUpsertBatch([
        { path: '/user/batch-new.txt', text: 'new' },
        { path: '/user/batch-a.txt', text: 'stale-overwrite', expectedContentRevisionId: staleA },
        { path: '/user/batch-b.txt', text: 'ok', expectedContentRevisionId: revB },
      ])
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof FilesContentRevisionMismatchError)
    // 整批未提交：新文件没被创建，未被点名的 b 也没被覆写
    assert.equal(await filesStat('/user/batch-new.txt'), undefined)
    assert.equal(await filesReadText('/user/batch-b.txt'), 'b0')
    assert.equal(await filesReadText('/user/batch-a.txt'), 'a1')

    // 全部匹配时批量成功
    const revA = (await filesStat('/user/batch-a.txt')).contentRevisionId!
    const entries = await filesUpsertBatch([
      { path: '/user/batch-new.txt', text: 'new' },
      { path: '/user/batch-a.txt', text: 'a2', expectedContentRevisionId: revA },
      { path: '/user/batch-b.txt', bytes: new TextEncoder().encode('B1').buffer as ArrayBuffer },
    ])
    assert.equal(entries.length, 3)
    assert.equal((await filesReadText('/user/batch-new.txt')), 'new')
    assert.equal(await filesReadText('/user/batch-a.txt'), 'a2')
  }

  // 6. 批量里对不存在的路径带期望版本 → 视为不匹配（当前=无）
  await resetState()
  {
    let caught: unknown
    try {
      await filesUpsertBatch([
        { path: '/user/ghost.txt', text: '?', expectedContentRevisionId: 'some-rev' },
      ])
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof FilesContentRevisionMismatchError)
    if (caught instanceof FilesContentRevisionMismatchError) {
      assert.equal(caught.current, undefined)
    }
    assert.equal(await filesStat('/user/ghost.txt'), undefined)
  }

  // 7. 结构性操作不受影响：不校验期望版本（参数面也没有）
  await resetState()
  {
    const folder = await filesMkdir('/user/struct-dir')
    assert.equal(folder.kind, 'folder')
    const file = await filesCreateText('/user/struct-dir/f.txt', 'x')
    const renamed = await filesRename('/user/struct-dir/f.txt', 'g.txt')
    assert.equal(renamed.name, 'g.txt')
    await filesRemove('/user/struct-dir/g.txt')
    assert.equal(await filesStat('/user/struct-dir/g.txt'), undefined)
    assert.ok(file) // 避免 unused 断言噪声
  }

  console.log('files-write-revision-check.test.ts: all assertions passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
