/**
 * 下载核心模块单测。
 * 运行：node --experimental-strip-types src/downloader/downloader-core.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { invalidateFilesVfsPathCaches, resolveNodeByAbsolutePath } from '../apps/files/files-vfs.ts'
import {
  filesCreateBinary,
  filesMkdir,
  filesReadBlob,
  filesReadBlobRange,
  filesReadText,
  filesRemove,
  filesStat,
  filesWriteBinary,
  filesWriteBytesRange,
} from '../apps/files/files-api.ts'
import { resetFilesDbForTests } from '../apps/files/files-storage.ts'
import { osNowMs } from '../os/os-clock.ts'
import type { DownloadTask } from './downloader-types.ts'
import {
  addCompletedRange,
  hasDownloadHeader,
  mergeByteRanges,
  readDownloadHeader,
  serializeDownloadHeader,
  subtractByteRanges,
  type InstantDownloadHeader,
} from './download-header.ts'
import { parseMetalink, MetalinkParseError } from './metalink-parser.ts'
import { md5Hex } from './md5.ts'
import { DownloadEngineError, runDownloadTask, type DownloaderEngineDeps } from './downloader-engine.ts'
import { addDownload, cancelDownload, listDownloads, loadDownloadTasks, pauseDownload, resetDownloadTasksForTests, resumeDownload } from './downloader-core.ts'
import type { DownloaderEngineDeps as EngineDepsType } from './downloader-engine.ts'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function bytesToString(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return new TextDecoder().decode(view)
}

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
  await resolveNodeByAbsolutePath('/user/.warmup-probe')
  invalidateFilesVfsPathCaches()
  resetDownloadTasksForTests()
}

async function bufferToHex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---- Metalink 解析器 ----

async function testMetalinkSingleFileWithMirrors(): Promise<void> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metalink version="3.0" xmlns="http://www.metalinker.org/">
  <files>
    <file name="big.zip">
      <size>12345678</size>
      <hash type="sha-256">aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</hash>
      <resources>
        <url location="us">https://mirror1.example/big.zip</url>
        <url location="eu">https://mirror2.example/big.zip</url>
      </resources>
    </file>
  </files>
</metalink>`
  const manifest = parseMetalink(xml)
  assert.equal(manifest.kind, 'metalink')
  assert.equal(manifest.name, 'big.zip')
  assert.equal(manifest.totalSize, 12345678)
  assert.equal(manifest.pieces.length, 1)
  assert.equal(manifest.pieces[0]!.urls.length, 2)
  assert.equal(manifest.pieces[0]!.urls[0], 'https://mirror1.example/big.zip')
  assert.equal(manifest.pieces[0]!.hash?.algorithm, 'sha-256')
  console.log('ok: metalink single file with mirrors')
}

async function testMetalinkWithPieces(): Promise<void> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<metalink version="3.0">
  <files>
    <file name="ubuntu.iso">
      <size>1000</size>
      <resources>
        <url>https://a.example/u</url>
      </resources>
      <pieces length="300">
        <hash>1111111111111111111111111111111111111111111111111111111111111111</hash>
        <hash>2222222222222222222222222222222222222222222222222222222222222222</hash>
        <hash>3333333333333333333333333333333333333333333333333333333333333333</hash>
        <hash>4444444444444444444444444444444444444444444444444444444444444444</hash>
      </pieces>
    </file>
  </files>
</metalink>`
  const manifest = parseMetalink(xml)
  assert.equal(manifest.pieces.length, 4)
  assert.equal(manifest.pieces[0]!.offset, 0)
  assert.equal(manifest.pieces[0]!.size, 300)
  assert.equal(manifest.pieces[1]!.offset, 300)
  assert.equal(manifest.pieces[1]!.size, 300)
  assert.equal(manifest.pieces[2]!.offset, 600)
  assert.equal(manifest.pieces[2]!.size, 300)
  assert.equal(manifest.pieces[3]!.offset, 900)
  assert.equal(manifest.pieces[3]!.size, 100)
  console.log('ok: metalink with pieces')
}

async function testMetalinkInvalid(): Promise<void> {
  assert.throws(() => parseMetalink('not xml'), MetalinkParseError)
  assert.throws(() => parseMetalink('<root></root>'), MetalinkParseError)
  assert.throws(
    () => parseMetalink('<metalink><files><file name="x"><resources></resources></file></files></metalink>'),
    MetalinkParseError,
  )
  console.log('ok: metalink invalid')
}

// ---- .download header ----

async function testHeaderRoundTrip(): Promise<void> {
  const header: InstantDownloadHeader = {
    magic: 'INSTANT-DL',
    version: 1,
    taskId: 'task:1',
    manifest: { kind: 'single', url: 'https://example.com/f', totalSize: 10 },
    totalSize: 10,
    completedRanges: [{ start: 0, end: 3 }],
    stats: { bytesDownloaded: 3, startedAt: 1, updatedAt: 2 },
  }
  const bytes = serializeDownloadHeader(header)
  assert.equal(hasDownloadHeader(bytes), true)
  const parsed = readDownloadHeader(bytes)
  assert.ok(parsed)
  assert.equal(parsed.header.taskId, 'task:1')
  assert.equal(parsed.header.totalSize, 10)
  assert.deepEqual(parsed.header.completedRanges, [{ start: 0, end: 3 }])
  console.log('ok: header round trip')
}

async function testMergeSubtractRanges(): Promise<void> {
  const merged = mergeByteRanges([
    { start: 0, end: 3 },
    { start: 2, end: 5 },
    { start: 7, end: 9 },
  ])
  assert.deepEqual(merged, [
    { start: 0, end: 5 },
    { start: 7, end: 9 },
  ])
  const added = addCompletedRange(merged, 5, 7)
  assert.deepEqual(added, [{ start: 0, end: 9 }])
  const missing = subtractByteRanges(10, added)
  assert.deepEqual(missing, [{ start: 9, end: 10 }])
  console.log('ok: merge and subtract ranges')
}

// ---- 下载引擎（mock 依赖） ----

type FakeFile = { path: string; bytes: Uint8Array }

class FakeFileSystem {
  files = new Map<string, Uint8Array>()

  async mkdir(_path: string): Promise<void> {}

  async stat(path: string): Promise<{ byteSize: number } | undefined> {
    const bytes = this.files.get(path)
    if (!bytes) return undefined
    return { byteSize: bytes.byteLength }
  }

  async readText(path: string): Promise<string> {
    const bytes = this.files.get(path)
    if (!bytes) throw new Error('文件不存在')
    return bytesToString(bytes)
  }

  async readBlobRange(path: string, offset: number, length: number): Promise<Blob> {
    const bytes = this.files.get(path)
    if (!bytes) throw new Error('文件不存在')
    const end = length === 0 ? bytes.byteLength : Math.min(bytes.byteLength, offset + length)
    return new Blob([bytes.subarray(offset, end)])
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, new Uint8Array(data))
  }

  async writeBytesRange(path: string, offset: number, data: ArrayBuffer | Uint8Array): Promise<void> {
    const view = data instanceof Uint8Array ? data : new Uint8Array(data)
    const end = offset + view.byteLength
    let current = this.files.get(path) ?? new Uint8Array(0)
    if (end > current.byteLength) {
      const next = new Uint8Array(end)
      next.set(current, 0)
      current = next
    }
    current.set(view, offset)
    this.files.set(path, current)
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, new Uint8Array(data))
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }
}

type FakeResponseSpec =
  | { type: 'ok'; body: Uint8Array }
  | { type: 'error'; status?: number; message?: string }

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

class FakeFetchServer {
  private resources = new Map<string, FakeResponseSpec>()
  private gates = new Map<string, { promise: Promise<void>; resolve: () => void }>()
  private active = 0
  private maxActive = 0
  private log: { url: string; headers?: Record<string, string> }[] = []

  setResource(url: string, spec: FakeResponseSpec): void {
    this.resources.set(url, spec)
  }

  hold(url: string): void {
    let resolve: () => void = () => undefined
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    this.gates.set(url, { promise, resolve })
  }

  release(url: string): void {
    const gate = this.gates.get(url)
    if (gate) {
      gate.resolve()
      this.gates.delete(url)
    }
  }

  getMaxActive(): number {
    return this.maxActive
  }

  getLog(): { url: string; headers?: Record<string, string> }[] {
    return this.log
  }

  createFetch(): FetchImpl {
    const server = this
    return async function fakeFetch(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const gate = server.gates.get(url)
      if (gate) {
        await gate.promise
      }
      const spec = server.resources.get(url)
      server.log.push({ url, headers: init?.headers as Record<string, string> })
      server.active += 1
      server.maxActive = Math.max(server.maxActive, server.active)
      try {
        if (!spec || spec.type === 'error') {
          throw new Error(spec?.message ?? 'network error')
        }
        const rangeHeader = (init?.headers as Record<string, string> | undefined)?.Range
        let body = spec.body
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d+)/)
          if (match) {
            const start = Number(match[1])
            const end = Number(match[2]) + 1
            body = spec.body.subarray(start, end)
          }
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(body)
              controller.close()
            },
          }),
          {
            status: rangeHeader ? 206 : 200,
            headers: { 'content-length': String(body.byteLength) },
          },
        )
      } finally {
        server.active -= 1
      }
    }
  }
}

function makeEngineDeps(fs: FakeFileSystem): EngineDepsType {
  return {
    writeFileBytesRange: (path, offset, bytes) => fs.writeBytesRange(path, offset, bytes),
    readFileBlobRange: (path, offset, length) => fs.readBlobRange(path, offset, length),
    createBinaryFile: (path, bytes) => fs.createBinary(path, bytes),
    writeBinaryFile: (path, bytes) => fs.writeBinary(path, bytes),
    statFile: (path) => fs.stat(path),
    nowMs: () => 1000,
  }
}

async function testEngineSingleFileDownload(): Promise<void> {
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const content = utf8('hello world this is a test download content')
  const hash = await bufferToHex(content.buffer)
  server.setResource('https://example.com/file.bin', { type: 'ok', body: content })

  const task: DownloadTask = {
    id: 'task:1',
    targetPath: '/user/Downloads/file.bin',
    state: 'running',
    manifest: {
      kind: 'single',
      url: 'https://example.com/file.bin',
      totalSize: content.byteLength,
      hash: { algorithm: 'sha-256', value: hash },
    },
    createdAt: 1,
    updatedAt: 1,
  }

  await runDownloadTask(task, { concurrency: 1 }, { ...makeEngineDeps(fs), fetch: server.createFetch() })

  const final = await fs.readBlobRange(task.targetPath, 0, 0)
  const finalBytes = new Uint8Array(await final.arrayBuffer())
  assert.deepEqual(finalBytes, content)
  assert.equal(fs.files.has(task.targetPath), true)
  console.log('ok: engine single file download')
}

async function testEngineResumeSkipsCompleted(): Promise<void> {
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const total = utf8('0123456789abcdefghijklmnopqrstuvwxyz')
  server.setResource('https://example.com/all.bin', { type: 'ok', body: total })

  const header: InstantDownloadHeader = {
    magic: 'INSTANT-DL',
    version: 1,
    taskId: 'task:resume',
    manifest: { kind: 'single', url: 'https://example.com/all.bin', totalSize: total.byteLength },
    totalSize: total.byteLength,
    completedRanges: [{ start: 0, end: 10 }],
    stats: { bytesDownloaded: 10, startedAt: 1, updatedAt: 1 },
  }
  const headerBytes = serializeDownloadHeader(header)
  const payloadOffset = headerBytes.byteLength
  const initial = new Uint8Array(payloadOffset + total.byteLength)
  initial.set(headerBytes, 0)
  initial.set(total, payloadOffset)
  await fs.createBinary('/user/Downloads/resume.bin', initial.buffer)

  const task: DownloadTask = {
    id: 'task:resume',
    targetPath: '/user/Downloads/resume.bin',
    state: 'running',
    manifest: header.manifest,
    createdAt: 1,
    updatedAt: 1,
  }

  await runDownloadTask(task, { concurrency: 1 }, { ...makeEngineDeps(fs), fetch: server.createFetch() })

  const log = server.getLog()
  const rangeRequests = log.filter((entry) => entry.headers?.Range)
  assert.equal(rangeRequests.length, 1)
  assert.ok(rangeRequests[0]!.headers!.Range.includes('bytes=10-'))

  const final = await fs.readBlobRange(task.targetPath, 0, 0)
  const finalBytes = new Uint8Array(await final.arrayBuffer())
  assert.deepEqual(finalBytes, total)
  console.log('ok: engine resume skips completed')
}

async function testEngineConcurrencyLimit(): Promise<void> {
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const total = new Uint8Array(10)
  for (let i = 0; i < 10; i += 1) total[i] = i
  server.setResource('https://example.com/ten.bin', { type: 'ok', body: total })

  const task: DownloadTask = {
    id: 'task:concurrent',
    targetPath: '/user/Downloads/ten.bin',
    state: 'running',
    manifest: { kind: 'single', url: 'https://example.com/ten.bin', totalSize: 10 },
    createdAt: 1,
    updatedAt: 1,
  }

  await runDownloadTask(task, { concurrency: 2 }, { ...makeEngineDeps(fs), fetch: server.createFetch() })

  assert.ok(server.getMaxActive() <= 2, `max concurrent ${server.getMaxActive()}`)
  console.log('ok: engine concurrency limit')
}

async function testEngineUrlFailover(): Promise<void> {
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const content = utf8('fallback content')
  server.setResource('https://bad.example/f.bin', { type: 'error', message: 'bad' })
  server.setResource('https://good.example/f.bin', { type: 'ok', body: content })

  const task: DownloadTask = {
    id: 'task:failover',
    targetPath: '/user/Downloads/f.bin',
    state: 'running',
    manifest: {
      kind: 'metalink',
      name: 'f.bin',
      totalSize: content.byteLength,
      pieces: [
        {
          index: 0,
          offset: 0,
          size: content.byteLength,
          urls: ['https://bad.example/f.bin', 'https://good.example/f.bin'],
        },
      ],
    },
    createdAt: 1,
    updatedAt: 1,
  }

  await runDownloadTask(task, { concurrency: 1, retryCount: 0 }, { ...makeEngineDeps(fs), fetch: server.createFetch() })

  const log = server.getLog()
  assert.equal(log.length, 2)
  assert.equal(log[0]!.url, 'https://bad.example/f.bin')
  assert.equal(log[1]!.url, 'https://good.example/f.bin')
  console.log('ok: engine url failover')
}

async function testEngineHashFailure(): Promise<void> {
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const content = utf8('some bytes')
  server.setResource('https://example.com/h.bin', { type: 'ok', body: content })

  const task: DownloadTask = {
    id: 'task:hashfail',
    targetPath: '/user/Downloads/h.bin',
    state: 'running',
    manifest: {
      kind: 'single',
      url: 'https://example.com/h.bin',
      totalSize: content.byteLength,
      hash: { algorithm: 'sha-256', value: '0000000000000000000000000000000000000000000000000000000000000000' },
    },
    createdAt: 1,
    updatedAt: 1,
  }

  try {
  await runDownloadTask(task, { concurrency: 1 }, { ...makeEngineDeps(fs), fetch: server.createFetch() })
    assert.fail('expected hash failure')
  } catch (error) {
    assert.ok(error instanceof DownloadEngineError)
    assert.ok((error as Error).message.includes('hash'))
  }
  console.log('ok: engine hash failure')
}

// ---- MD5 ----

async function testMd5Vectors(): Promise<void> {
  assert.equal(md5Hex(utf8('')), 'd41d8cd98f00b204e9800998ecf8427e')
  assert.equal(md5Hex(utf8('abc')), '900150983cd24fb0d6963f7d28e17f72')
  assert.equal(
    md5Hex(utf8('The quick brown fox jumps over the lazy dog')),
    '9e107d9d372bb6826bd81d3542a419d6',
  )
  // 跨 64 字节块边界
  assert.equal(md5Hex(utf8('a'.repeat(1000))), 'cabe45dcc9ae5b66ba86600cca6b8ba8')
  console.log('ok: md5 vectors')
}

async function testEngineMd5Hash(): Promise<void> {
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const content = utf8('md5 hashed content')
  server.setResource('https://example.com/md5.bin', { type: 'ok', body: content })

  const task: DownloadTask = {
    id: 'task:md5',
    targetPath: '/user/Downloads/md5.bin',
    state: 'running',
    manifest: {
      kind: 'single',
      url: 'https://example.com/md5.bin',
      totalSize: content.byteLength,
      hash: { algorithm: 'md5', value: md5Hex(content) },
    },
    createdAt: 1,
    updatedAt: 1,
  }

  await runDownloadTask(task, { concurrency: 1 }, { ...makeEngineDeps(fs), fetch: server.createFetch() })

  const final = await fs.readBlobRange(task.targetPath, 0, 0)
  assert.deepEqual(new Uint8Array(await final.arrayBuffer()), content)
  console.log('ok: engine md5 hash')
}

async function testEngineMultiPieceSingleFileWithHash(): Promise<void> {
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const content = new Uint8Array(20)
  for (let i = 0; i < 20; i += 1) content[i] = i * 7
  const hash = await bufferToHex(content.buffer)
  server.setResource('https://example.com/mp.bin', { type: 'ok', body: content })

  const task: DownloadTask = {
    id: 'task:multipiece',
    targetPath: '/user/Downloads/mp.bin',
    state: 'running',
    manifest: {
      kind: 'single',
      url: 'https://example.com/mp.bin',
      totalSize: content.byteLength,
      hash: { algorithm: 'sha-256', value: hash },
    },
    createdAt: 1,
    updatedAt: 1,
  }

  // pieceSize 8 把 20 字节切成 3 块；整文件 hash 由 finalize 统一校验
  await runDownloadTask(
    task,
    { concurrency: 2, pieceSize: 8 },
    { ...makeEngineDeps(fs), fetch: server.createFetch() },
  )

  const final = await fs.readBlobRange(task.targetPath, 0, 0)
  assert.deepEqual(new Uint8Array(await final.arrayBuffer()), content)
  console.log('ok: engine multi piece single file with hash')
}

async function testEngineMetalinkResumePartialPiece(): Promise<void> {
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const content = new Uint8Array(600)
  for (let i = 0; i < 600; i += 1) content[i] = i % 251
  const piece0Hash = await bufferToHex(content.slice(0, 300).buffer)
  const piece1Hash = await bufferToHex(content.slice(300, 600).buffer)
  server.setResource('https://example.com/ml.bin', { type: 'ok', body: content })

  const manifest = {
    kind: 'metalink' as const,
    name: 'ml.bin',
    totalSize: 600,
    pieces: [
      {
        index: 0,
        offset: 0,
        size: 300,
        urls: ['https://example.com/ml.bin'],
        hash: { algorithm: 'sha-256' as const, value: piece0Hash },
      },
      {
        index: 1,
        offset: 300,
        size: 300,
        urls: ['https://example.com/ml.bin'],
        hash: { algorithm: 'sha-256' as const, value: piece1Hash },
      },
    ],
  }

  // 模拟上次中断：piece0 已下载前 150 字节
  const header: InstantDownloadHeader = {
    magic: 'INSTANT-DL',
    version: 1,
    taskId: 'task:ml-resume',
    manifest,
    totalSize: 600,
    completedRanges: [{ start: 0, end: 150 }],
    stats: { bytesDownloaded: 150, startedAt: 1, updatedAt: 1 },
  }
  const headerBytes = serializeDownloadHeader(header)
  const payloadOffset = headerBytes.byteLength
  const initial = new Uint8Array(payloadOffset + 600)
  initial.set(headerBytes, 0)
  initial.set(content.subarray(0, 150), payloadOffset)
  await fs.createBinary('/user/Downloads/ml.bin', initial.buffer)

  const task: DownloadTask = {
    id: 'task:ml-resume',
    targetPath: '/user/Downloads/ml.bin',
    state: 'running',
    manifest,
    createdAt: 1,
    updatedAt: 1,
  }

  await runDownloadTask(task, { concurrency: 1 }, { ...makeEngineDeps(fs), fetch: server.createFetch() })

  // piece0 只补缺失的 [150,300)，piece1 整块下载
  const ranges = server.getLog().map((entry) => entry.headers?.Range).filter(Boolean)
  assert.ok(ranges.includes('bytes=150-299'), `expected bytes=150-299, got ${ranges.join(',')}`)
  assert.ok(ranges.includes('bytes=300-599'), `expected bytes=300-599, got ${ranges.join(',')}`)

  const final = await fs.readBlobRange(task.targetPath, 0, 0)
  assert.deepEqual(new Uint8Array(await final.arrayBuffer()), content)
  console.log('ok: engine metalink resume partial piece')
}

async function testEngineAbortRecordsPartialProgress(): Promise<void> {
  const fs = new FakeFileSystem()
  const content = utf8('0123456789abcdefghijklmnopqrstuvwxyz')
  const firstChunk = content.subarray(0, 10)
  const controller = new AbortController()

  // 流式响应：先给 10 字节，之后挂起；signal 中止时按真实 fetch 语义让流报错
  const fetch: FetchImpl = async (_input, init) => {
    const signal = init?.signal
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(firstChunk)
        signal?.addEventListener('abort', () => {
          streamController.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      },
    })
    return new Response(stream, {
      status: 206,
      headers: { 'content-length': String(content.byteLength) },
    })
  }

  const task: DownloadTask = {
    id: 'task:abort-partial',
    targetPath: '/user/Downloads/partial.bin',
    state: 'running',
    manifest: {
      kind: 'single',
      url: 'https://example.com/partial.bin',
      totalSize: content.byteLength,
    },
    createdAt: 1,
    updatedAt: 1,
  }

  const run = runDownloadTask(
    task,
    { concurrency: 1, signal: controller.signal },
    { ...makeEngineDeps(fs), fetch },
  )
  await new Promise((resolve) => setTimeout(resolve, 20))
  controller.abort()
  await assert.rejects(run)

  // header 应已落盘，且包含中止前已写入的 [0,10)
  const blob = await fs.readBlobRange(task.targetPath, 0, 64 * 1024)
  const parsed = readDownloadHeader(new Uint8Array(await blob.arrayBuffer()))
  assert.ok(parsed, 'download header should be persisted')
  assert.deepEqual(parsed.header.completedRanges, [{ start: 0, end: 10 }])
  console.log('ok: engine abort records partial progress')
}

async function testEngineSpeedSlidingWindow(): Promise<void> {
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const content = new Uint8Array(30)
  for (let i = 0; i < 30; i += 1) content[i] = i
  server.setResource('https://example.com/speed.bin', { type: 'ok', body: content })

  // 可操控时钟：t=1000 起步，每个分块耗时 100ms
  let clock = 1000
  const samples: number[] = []

  const task: DownloadTask = {
    id: 'task:speed',
    targetPath: '/user/Downloads/speed.bin',
    state: 'running',
    manifest: {
      kind: 'single',
      url: 'https://example.com/speed.bin',
      totalSize: 30,
    },
    createdAt: 1,
    updatedAt: 1,
  }

  // 3 个 10 字节分块：第 1 块后模拟「暂停 10 秒」，再完成后两块
  let fetchCount = 0
  const baseFetch = server.createFetch()
  const deps = {
    ...makeEngineDeps(fs),
    nowMs: () => clock,
    fetch: (async (input, init) => {
      fetchCount += 1
      clock += 100
      if (fetchCount === 2) clock += 10_000 // 第 2 块前等了 10 秒
      return baseFetch(input, init)
    }) as FetchImpl,
  }

  await runDownloadTask(
    task,
    { concurrency: 1, pieceSize: 10, onProgress: (p) => samples.push(p.bytesPerSecond) },
    deps,
  )

  // 每块 10 字节 / 100ms = 100 B/s。暂停后的第一个样本会被拉低（窗口含暂停），
  // 但之后的样本必须恢复；旧算法「总字节 ÷ 含暂停的总耗时」只会越拖越低、永不恢复。
  assert.equal(samples[0], 100)
  assert.equal(samples[samples.length - 1], 100)
  console.log('ok: engine speed sliding window')
}

// ---- 核心 API（mock 依赖） ----

async function testCoreAddDownloadSingle(): Promise<void> {
  await resetState()
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const content = utf8('core single download')
  const hash = await bufferToHex(content.buffer)
  server.setResource('https://example.com/core.bin', { type: 'ok', body: content })

  const fetch = server.createFetch()
  const deps = {
    ...makeEngineDeps(fs),
    mkdir: (path: string) => fs.mkdir(path),
    readText: (path: string) => fs.readText(path),
    writeBinary: (path: string, bytes: ArrayBuffer) => fs.writeBinary(path, bytes),
    removeFile: (path: string) => fs.remove(path),
    fetchHead: async () => {
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(content.byteLength) },
      })
    },
    fetch,
  }

  const task = await addDownload({ source: 'https://example.com/core.bin', concurrency: 1 }, { deps })
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert.equal(task.state, 'completed')
  assert.equal(listDownloads().length, 1)

  const final = await fs.readBlobRange(task.targetPath, 0, 0)
  const finalBytes = new Uint8Array(await final.arrayBuffer())
  assert.deepEqual(finalBytes, content)
  console.log('ok: core add single download')
}

async function testCorePauseResume(): Promise<void> {
  await resetState()
  const fs = new FakeFileSystem()
  const server = new FakeFetchServer()
  const content = utf8('pause resume test - longer content to allow pause mid stream')
  server.hold('https://example.com/pause.bin')
  server.setResource('https://example.com/pause.bin', { type: 'ok', body: content })

  const fetch = server.createFetch()
  const deps = {
    ...makeEngineDeps(fs),
    mkdir: (path: string) => fs.mkdir(path),
    readText: (path: string) => fs.readText(path),
    writeBinary: (path: string, bytes: ArrayBuffer) => fs.writeBinary(path, bytes),
    removeFile: (path: string) => fs.remove(path),
    fetchHead: async () =>
      new Response(null, { status: 200, headers: { 'content-length': String(content.byteLength) } }),
    fetch,
  }

  const task = await addDownload({ source: 'https://example.com/pause.bin', concurrency: 1 }, { deps })
  await pauseDownload(task.id, { deps })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(listDownloads()[0]!.state, 'paused')

  await resumeDownload(task.id, { deps })
  server.release('https://example.com/pause.bin')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(listDownloads()[0]!.state, 'completed')
  console.log('ok: core pause resume')
}

async function testCoreLoadTasks(): Promise<void> {
  await resetState()
  const fs = new FakeFileSystem()
  const saved: DownloadTask = {
    id: 'task:loaded',
    targetPath: '/user/Downloads/loaded.bin',
    state: 'paused',
    manifest: { kind: 'single', url: 'https://example.com/loaded.bin', totalSize: 5 },
    createdAt: 1,
    updatedAt: 2,
  }
  await fs.writeBinary('/dev/downloader/tasks.json', utf8(JSON.stringify({ version: 1, tasks: [saved] })).buffer)

  const deps = {
    ...makeEngineDeps(fs),
    mkdir: (path: string) => fs.mkdir(path),
    readText: (path: string) => fs.readText(path),
    writeBinary: (path: string, bytes: ArrayBuffer) => fs.writeBinary(path, bytes),
    removeFile: (path: string) => fs.remove(path),
  }

  await loadDownloadTasks({ deps })
  const tasks = listDownloads()
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0]!.id, 'task:loaded')
  assert.equal(tasks[0]!.state, 'paused')
  console.log('ok: core load tasks')
}

async function main(): Promise<void> {
  await testMetalinkSingleFileWithMirrors()
  await testMetalinkWithPieces()
  await testMetalinkInvalid()
  await testHeaderRoundTrip()
  await testMergeSubtractRanges()
  await testEngineSingleFileDownload()
  await testEngineResumeSkipsCompleted()
  await testEngineConcurrencyLimit()
  await testEngineUrlFailover()
  await testEngineHashFailure()
  await testMd5Vectors()
  await testEngineMd5Hash()
  await testEngineMultiPieceSingleFileWithHash()
  await testEngineMetalinkResumePartialPiece()
  await testEngineAbortRecordsPartialProgress()
  await testEngineSpeedSlidingWindow()
  await testCoreAddDownloadSingle()
  await testCorePauseResume()
  await testCoreLoadTasks()
  console.log('all downloader core tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
