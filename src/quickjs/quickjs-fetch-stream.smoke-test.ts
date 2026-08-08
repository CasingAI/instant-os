/**
 * 客侧 fetch 流式下载 + pipeline 冒烟测试。
 *
 * 验证：
 *  A. fetch(url).body 返回 ReadableStream（非 null）
 *  B. reader.read() 逐块返回 {value, done}
 *  C. pipeline(res.body, fs.createWriteStream(dest)) 边下边存
 *  D. 下载后文件内容完整
 *  E. arrayBuffer() 行为回归（流式消费）
 *  F. Response.bodyUsed 语义
 */
import 'fake-indexeddb/auto'
import { createQuickJsInstance } from './quickjs-instance.ts'
import { filesMkdir, filesRemove, filesReadText, filesStat } from '../apps/files/files-api.ts'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'

const TEST_PORT = 19876
const TEST_PAYLOAD = '0123456789'.repeat(500) // 5 KiB, 10 chunks à 512 bytes each

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(Buffer.byteLength(TEST_PAYLOAD)),
      })
      res.end(TEST_PAYLOAD)
    })
    server.listen(TEST_PORT, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()))
          }),
      })
    })
    server.on('error', reject)
  })
}

async function testFetchStreaming() {
  const server = await startServer()

  try {
    const root = '/user/qjs-fetch-stream-smoke'
    const existing = await filesStat(root)
    if (existing !== undefined) {
      await filesRemove(root)
    }

    // --- A. body 是非 null ReadableStream ---
    const instA = await createQuickJsInstance({
      workspaceRoot: '/user',
      permissions: { network: true, fsReadRoots: ['/'], fsWriteRoots: ['/'] },
      timeoutMs: 15_000,
    })
    const bodyCheck = await instA.eval(`
      fetch('${server.url}').then(function (res) {
        if (res.body == null) {
          globalThis.__bodyCheck = 'ERROR: body is null'
          return
        }
        if (typeof res.body.getReader !== 'function') {
          globalThis.__bodyCheck = 'ERROR: no getReader'
          return
        }
        globalThis.__bodyCheck = 'ok'
      })
      'scheduled'
    `)
    if (!bodyCheck.ok) {
      throw new Error(`body check eval failed: ${JSON.stringify(bodyCheck)}`)
    }
    await sleep(100)
    const bodyResult = await instA.eval('globalThis.__bodyCheck')
    if (!bodyResult.ok || bodyResult.value !== 'ok') {
      throw new Error(`body check: ${JSON.stringify(bodyResult)}`)
    }
    instA.destroy()
    console.log('ok: fetch(body) returns ReadableStream')

    // --- B. reader.read() 逐块返回 ---
    const instB = await createQuickJsInstance({
      workspaceRoot: '/user',
      permissions: { network: true, fsReadRoots: ['/'], fsWriteRoots: ['/'] },
      timeoutMs: 15_000,
    })
    const readerCheck = await instB.eval(`
      fetch('${server.url}').then(function (res) {
        var reader = res.body.getReader()
        var chunks = []
        function readNext() {
          return reader.read().then(function (result) {
            if (result.done) {
              var total = ''
              for (var i = 0; i < chunks.length; i++) {
                total += Buffer.from(chunks[i]).toString('utf8')
              }
              globalThis.__readerCheck = { ok: true, total: total.length }
              return
            }
            chunks.push(result.value)
            return readNext()
          })
        }
        return readNext()
      }).catch(function (e) {
        globalThis.__readerCheck = { ok: false, error: String(e && e.message ? e.message : e) }
      })
      'scheduled'
    `)
    if (!readerCheck.ok) {
      throw new Error(`reader check eval failed: ${JSON.stringify(readerCheck)}`)
    }
    await sleep(200)
    const readerResult = await instB.eval('globalThis.__readerCheck')
    if (!readerResult.ok) {
      throw new Error(`reader check result failed: ${JSON.stringify(readerResult)}`)
    }
    const rv = readerResult.value as { ok?: boolean; error?: string; total?: number }
    if (rv.error) {
      throw new Error(`reader error: ${rv.error}`)
    }
    if (rv.total !== TEST_PAYLOAD.length) {
      throw new Error(`reader total: expected ${TEST_PAYLOAD.length}, got ${rv.total}`)
    }
    instB.destroy()
    console.log('ok: reader.read() chunks correct')

    // --- C. pipeline(res.body, createWriteStream(dest)) ---
    await filesMkdir(root)
    const instC = await createQuickJsInstance({
      workspaceRoot: root,
      permissions: { network: true, fsReadRoots: ['/'], fsWriteRoots: ['/'] },
      timeoutMs: 15_000,
    })
    const pipelineCheck = await instC.eval(`
      var { pipeline } = require('stream')
      var fs = require('fs')
      fetch('${server.url}').then(function (res) {
        var dest = fs.createWriteStream('downloaded.bin')
        return pipeline(res.body, dest)
      }).then(function () {
        globalThis.__pipelineCheck = 'ok'
      }).catch(function (e) {
        globalThis.__pipelineCheck = 'ERROR: ' + (e && e.message ? e.message : e)
      })
      'scheduled'
    `)
    if (!pipelineCheck.ok) {
      throw new Error(`pipeline eval failed: ${JSON.stringify(pipelineCheck)}`)
    }
    await sleep(500)
    const pipelineResult = await instC.eval('globalThis.__pipelineCheck')
    if (!pipelineResult.ok || pipelineResult.value !== 'ok') {
      throw new Error(`pipeline check: ${JSON.stringify(pipelineResult)}`)
    }

    // 验证文件内容
    const content = await filesReadText(`${root}/downloaded.bin`)
    if (content !== TEST_PAYLOAD) {
      throw new Error(
        `pipeline content mismatch: expected ${TEST_PAYLOAD.length} bytes, got ${content.length}`,
      )
    }
    instC.destroy()
    console.log('ok: pipeline(fetch.body, createWriteStream) works')

    // --- D. cancel 中断清理 ---
    const instD = await createQuickJsInstance({
      workspaceRoot: root,
      permissions: { network: true, fsReadRoots: ['/'], fsWriteRoots: ['/'] },
      timeoutMs: 15_000,
    })
    const cancelCheck = await instD.eval(`
      fetch('${server.url}').then(function (res) {
        var reader = res.body.getReader()
        return reader.read().then(function () {
          return reader.cancel()
        }).then(function () {
          return reader.read()
        }).then(function (result) {
          globalThis.__cancelCheck = { done: result.done, value: result.value === undefined }
        })
      }).catch(function (e) {
        globalThis.__cancelCheck = { error: String(e && e.message ? e.message : e) }
      })
      'scheduled'
    `)
    if (!cancelCheck.ok) {
      throw new Error(`cancel eval failed: ${JSON.stringify(cancelCheck)}`)
    }
    await sleep(200)
    const cancelResult = await instD.eval('globalThis.__cancelCheck')
    if (!cancelResult.ok) {
      throw new Error(`cancel result failed: ${JSON.stringify(cancelResult)}`)
    }
    const cv = cancelResult.value as { done?: boolean; value?: boolean; error?: string }
    if (cv.error) {
      throw new Error(`cancel error: ${cv.error}`)
    }
    if (cv.done !== true || cv.value !== true) {
      throw new Error(`cancel: expected done=true, got ${JSON.stringify(cv)}`)
    }
    instD.destroy()
    console.log('ok: reader.cancel() works')

    // --- E. arrayBuffer() 回归（流式消费） ---
    const instE = await createQuickJsInstance({
      workspaceRoot: '/user',
      permissions: { network: true, fsReadRoots: ['/'], fsWriteRoots: ['/'] },
      timeoutMs: 15_000,
    })
    const abCheck = await instE.eval(`
      fetch('${server.url}').then(function (res) {
        return res.arrayBuffer()
      }).then(function (ab) {
        var text = new TextDecoder().decode(ab)
        globalThis.__abCheck = { ok: true, len: ab.byteLength, match: text === '${TEST_PAYLOAD.slice(0, 20)}' + '...' ? 'prefix' : 'full' }
      }).catch(function (e) {
        globalThis.__abCheck = { ok: false, error: String(e && e.message ? e.message : e) }
      })
      'scheduled'
    `)
    if (!abCheck.ok) {
      throw new Error(`abCheck eval failed: ${JSON.stringify(abCheck)}`)
    }
    await sleep(200)
    const abResult = await instE.eval('globalThis.__abCheck')
    if (!abResult.ok) {
      throw new Error(`abCheck result failed: ${JSON.stringify(abResult)}`)
    }
    const abv = abResult.value as { ok?: boolean; error?: string; len?: number }
    if (abv.error) {
      throw new Error(`arrayBuffer error: ${abv.error}`)
    }
    if (abv.len !== TEST_PAYLOAD.length) {
      throw new Error(`arrayBuffer len: expected ${TEST_PAYLOAD.length}, got ${abv.len}`)
    }
    instE.destroy()
    console.log('ok: arrayBuffer() streaming works')

    // --- F. bodyUsed 语义 ---
    const instF = await createQuickJsInstance({
      workspaceRoot: '/user',
      permissions: { network: true, fsReadRoots: ['/'], fsWriteRoots: ['/'] },
      timeoutMs: 15_000,
    })
    const bodyUsedCheck = await instF.eval(`
      fetch('${server.url}').then(function (res) {
        return res.arrayBuffer().then(function () {
          globalThis.__bodyUsedAfter = res.bodyUsed
          try {
            var reader = res.body.getReader()
            globalThis.__bodyUsedDouble = 'ERROR: should have thrown'
          } catch (e) {
            globalThis.__bodyUsedDouble = 'ok'
          }
        })
      }).catch(function (e) {
        globalThis.__bodyUsedCheck = 'ERROR: ' + (e && e.message ? e.message : e)
      })
      'scheduled'
    `)
    if (!bodyUsedCheck.ok) {
      throw new Error(`bodyUsed eval failed: ${JSON.stringify(bodyUsedCheck)}`)
    }
    await sleep(200)
    const buAfter = await instF.eval('globalThis.__bodyUsedAfter')
    if (!buAfter.ok || buAfter.value !== true) {
      throw new Error(`bodyUsed should be true after arrayBuffer: ${JSON.stringify(buAfter)}`)
    }
    const buDouble = await instF.eval('globalThis.__bodyUsedDouble')
    if (!buDouble.ok || buDouble.value !== 'ok') {
      throw new Error(`bodyUsed should prevent double read: ${JSON.stringify(buDouble)}`)
    }
    instF.destroy()
    console.log('ok: bodyUsed semantics correct')

    console.log('quickjs-fetch-stream: all passed')
  } finally {
    await server.close()
  }
}

testFetchStreaming().catch((err) => {
  console.error('FAIL:', err)
  process.exit(1)
})