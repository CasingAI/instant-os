/**
 * 第九期：iCode agent「记读、写时带期望版本」拦截器验收。
 * 运行：node --experimental-strip-types src/quickjs/fs-revision-memory-interceptor.test.ts
 *
 * 场景：读后写成功 / 读后被外部改→拒→重读后再写成功 / 从未读就写盲写放行 /
 * stat 也算读记账 / 写入成功刷新记录 / unlink 剔除记录 / 两实例记忆互不影响。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { resetFilesDbForTests } from '../apps/files/files-storage.ts'
import {
  filesCreateText,
  filesMkdir,
  filesReadText,
  filesRemove,
  filesStat,
  filesWriteText,
} from '../apps/files/files-api.ts'
import { invalidateFilesVfsPathCaches } from '../apps/files/files-vfs.ts'
import { createQuickJsInstance } from './quickjs-instance.ts'
import { createFsRevisionMemoryInterceptor } from './fs-revision-memory-interceptor.ts'

const ROOT = '/user/frm-smoke'

type AgentInstance = Awaited<ReturnType<typeof createQuickJsInstance>>

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
  const existing = await filesStat(ROOT)
  if (existing !== undefined) {
    await filesRemove(ROOT)
  }
  await filesMkdir(ROOT)
}

async function evalOk(instance: AgentInstance, code: string): Promise<unknown> {
  const result = await instance.eval(code)
  assert.equal(result.ok, true, `eval 失败: ${result.ok ? '' : String(result.error)}`)
  return result.value
}

async function main(): Promise<void> {
  // 1. 读后写成功：拦截器自动带上匹配的期望版本
  await resetState()
  await filesCreateText(`${ROOT}/a.txt`, 'v1')
  const agent = await createQuickJsInstance({
    workspaceRoot: ROOT,
    timeoutMs: 10_000,
    interceptors: [createFsRevisionMemoryInterceptor()],
  })
  {
    const value = (await evalOk(
      agent,
      `
      var fs = require('fs')
      var before = fs.readFileSync('a.txt', 'utf8')
      fs.writeFileSync('a.txt', 'v2-by-agent')
      ;({ before: before, after: fs.readFileSync('a.txt', 'utf8') })
    `,
    )) as { before: string; after: string }
    assert.deepEqual(value, { before: 'v1', after: 'v2-by-agent' })
    assert.equal(await filesReadText(`${ROOT}/a.txt`), 'v2-by-agent')
  }

  // 2. 读后被外部改 → 拒（权限类错误，中文提示重读）→ 重读后再写成功；
  //    appendFile 同样被拦；写入成功后记录随 writtenContentRevisionId 刷新。
  {
    await filesWriteText(`${ROOT}/a.txt`, 'v3-external')
    const err = (await evalOk(
      agent,
      `
      var fs = require('fs')
      try {
        fs.writeFileSync('a.txt', 'stale-write')
        'wrote'
      } catch (e) {
        ;({ code: e && e.code, message: String(e && e.message ? e.message : e) })
      }
    `,
    )) as { code?: string; message: string }
    assert.equal(err.code, 'EACCES', `应为权限类错误，实际 ${JSON.stringify(err)}`)
    assert.ok(err.message.includes('已被外部修改'), `信息应说明外部修改：${err.message}`)
    assert.ok(err.message.includes('请重读后重试'), `信息应提示重读：${err.message}`)
    assert.equal(await filesReadText(`${ROOT}/a.txt`), 'v3-external', '过期写不应覆盖')

    const appended = (await evalOk(
      agent,
      `
      var fs = require('fs')
      try {
        fs.appendFileSync('a.txt', '-more')
        'appended'
      } catch (e) {
        ;({ code: e && e.code })
      }
    `,
    )) as { code?: string }
    assert.equal(appended.code, 'EACCES', 'appendFile 同样应被核对')

    const value = (await evalOk(
      agent,
      `
      var fs = require('fs')
      var cur = fs.readFileSync('a.txt', 'utf8')
      fs.writeFileSync('a.txt', 'v4-after-reread')
      fs.appendFileSync('a.txt', '-tail')
      ;({ cur: cur, final: fs.readFileSync('a.txt', 'utf8') })
    `,
    )) as { cur: string; final: string }
    assert.deepEqual(value, { cur: 'v3-external', final: 'v4-after-reread-tail' })

    // 刷新验证：agent 自己写完后再被外部改一次，不重读直接写必须再被拒
    await filesWriteText(`${ROOT}/a.txt`, 'v5-external-again')
    const again = (await evalOk(
      agent,
      `
      try {
        require('fs').writeFileSync('a.txt', 'blind-after-refresh')
        'wrote'
      } catch (e) {
        ;({ code: e && e.code })
      }
    `,
    )) as { code?: string }
    assert.equal(again.code, 'EACCES', '写入成功应已刷新记录，旧值不可再用')
  }

  // 3. 未读过的路径盲写放行
  {
    const value = (await evalOk(
      agent,
      `
      require('fs').writeFileSync('never-read.txt', 'fresh-blind')
      'ok'
    `,
    )) as string
    assert.equal(value, 'ok')
    assert.equal(await filesReadText(`${ROOT}/never-read.txt`), 'fresh-blind')

    // b.txt：沙箱先读过 → 再在沙箱里删掉 → 外部用新内容重建同名文件 → 沙箱直接写应放行
    // （unlink 剔除记录；否则会带着删前旧版本号对新建文件校验而被误拒）
    await filesCreateText(`${ROOT}/b.txt`, 'seed')
    await evalOk(agent, `require('fs').readFileSync('b.txt', 'utf8'); 'read'`)
    await evalOk(agent, `require('fs').unlinkSync('b.txt'); 'unlinked'`)
    await filesCreateText(`${ROOT}/b.txt`, 'recreated-externally')
    await evalOk(agent, `require('fs').writeFileSync('b.txt', 'rewritten-by-agent'); 'wrote'`)
    assert.equal(await filesReadText(`${ROOT}/b.txt`), 'rewritten-by-agent')
    assert.equal(await filesReadText(`${ROOT}/never-read.txt`), 'fresh-blind')
  }
  agent.destroy()

  // 4. stat/access 记账：只 stat 过也算「读」
  await resetState()
  await filesCreateText(`${ROOT}/c.txt`, 'c1')
  {
    const agentC = await createQuickJsInstance({
      workspaceRoot: ROOT,
      timeoutMs: 10_000,
      interceptors: [createFsRevisionMemoryInterceptor()],
    })
    await evalOk(agentC, `require('fs').statSync('c.txt'); 'stated'`)
    await filesWriteText(`${ROOT}/c.txt`, 'c2-external')
    const denied = (await evalOk(
      agentC,
      `
      try {
        require('fs').writeFileSync('c.txt', 'stale-after-stat')
        'wrote'
      } catch (e) {
        ;({ code: e && e.code })
      }
    `,
    )) as { code?: string }
    assert.equal(denied.code, 'EACCES', 'stat 记下的版本过期后也应拒绝')
    agentC.destroy()
  }

  // 5. 两实例隔离：各自一份记忆；A 的陈旧期望不影响 B 的盲写
  await resetState()
  await filesCreateText(`${ROOT}/d.txt`, 'iso-v1')
  {
    const a = await createQuickJsInstance({
      workspaceRoot: ROOT,
      timeoutMs: 10_000,
      interceptors: [createFsRevisionMemoryInterceptor()],
    })
    const b = await createQuickJsInstance({
      workspaceRoot: ROOT,
      timeoutMs: 10_000,
      interceptors: [createFsRevisionMemoryInterceptor()],
    })
    await evalOk(a, `require('fs').readFileSync('d.txt', 'utf8'); 'a-read'`)
    await filesWriteText(`${ROOT}/d.txt`, 'iso-v2-external')

    // B 没读过 → 盲写放行；A 持旧版本 → 被拒
    const wroteB = await evalOk(b, `require('fs').writeFileSync('d.txt', 'iso-v3-from-b'); 'b-wrote'`)
    assert.equal(wroteB, 'b-wrote')
    const deniedA = (await evalOk(
      a,
      `
      try {
        require('fs').writeFileSync('d.txt', 'stale-from-a')
        'wrote'
      } catch (e) {
        ;({ code: e && e.code })
      }
    `,
    )) as { code?: string }
    assert.equal(deniedA.code, 'EACCES', 'A 的记录不应被 B 的写入刷新')
    assert.equal(await filesReadText(`${ROOT}/d.txt`), 'iso-v3-from-b')

    // A 重读后恢复可写
    await evalOk(a, `var __cur = require('fs').readFileSync('d.txt', 'utf8')`)
    await evalOk(a, `require('fs').writeFileSync('d.txt', 'iso-v4-from-a')`)
    assert.equal(await filesReadText(`${ROOT}/d.txt`), 'iso-v4-from-a')
    a.destroy()
    b.destroy()
  }

  console.log('fs-revision-memory-interceptor.test.ts: all assertions passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
