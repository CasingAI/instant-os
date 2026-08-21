/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-download-stream.test.ts
 */
import assert from 'node:assert/strict'
import { pipeChunksToStreamWriter } from './chromo-download-stream.ts'

class FakeWriter {
  chunks: Uint8Array[] = []
  closed = false
  aborted = false

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed || this.aborted) {
      throw new Error('writer already finished')
    }
    this.chunks.push(chunk)
  }

  async close(): Promise<void> {
    if (this.aborted) {
      throw new Error('aborted')
    }
    this.closed = true
  }

  async abort(): Promise<void> {
    this.aborted = true
  }
}

async function* chunksOf(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield new TextEncoder().encode(part)
  }
}

async function* failingChunks(): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode('aa')
  throw new Error('network drop')
}

async function testCloseWritesAllChunks(): Promise<void> {
  const writer = new FakeWriter()
  const received = await pipeChunksToStreamWriter(writer, chunksOf('hel', 'lo'), {
    progressIntervalMs: 0,
  })
  assert.equal(received, 5)
  assert.equal(writer.closed, true)
  assert.equal(writer.aborted, false)
  assert.equal(new TextDecoder().decode(Buffer.concat(writer.chunks)), 'hello')
  console.log('ok: chunk then close')
}

async function testErrorAborts(): Promise<void> {
  const writer = new FakeWriter()
  await assert.rejects(() => pipeChunksToStreamWriter(writer, failingChunks()), /network drop/)
  assert.equal(writer.aborted, true)
  assert.equal(writer.closed, false)
  console.log('ok: error aborts writer')
}

async function testCancelAborts(): Promise<void> {
  const writer = new FakeWriter()
  const controller = new AbortController()
  async function* slow(): AsyncGenerator<Uint8Array> {
    yield new TextEncoder().encode('x')
    controller.abort()
    yield new TextEncoder().encode('y')
  }
  await assert.rejects(() => pipeChunksToStreamWriter(writer, slow(), { signal: controller.signal }))
  assert.equal(writer.aborted, true)
  console.log('ok: cancel aborts writer')
}

await testCloseWritesAllChunks()
await testErrorAborts()
await testCancelAborts()
console.log('chromo-download-stream tests passed')
