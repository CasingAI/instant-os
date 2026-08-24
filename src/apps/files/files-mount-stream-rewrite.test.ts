/**
 * 挂载卷流式改写：按块泵送，不把整份正文拼进内存。
 * 运行：node --experimental-strip-types src/apps/files/files-mount-stream-rewrite.test.ts
 */
import assert from 'node:assert/strict'
import {
  copyStreamToSink,
  rewriteRangeThroughSink,
} from './files-mount-stream-rewrite.ts'

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function streamOf(bytes: Uint8Array, piece: number): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      const end = Math.min(bytes.byteLength, offset + piece)
      controller.enqueue(bytes.slice(offset, end))
      offset = end
    },
  })
}

async function collectRewrite(params: {
  source: Uint8Array
  offset: number
  patch: Uint8Array
  piece?: number
  chunkSize?: number
}): Promise<{ out: Uint8Array; peak: number }> {
  const chunks: Uint8Array[] = []
  let peak = 0
  const size = await rewriteRangeThroughSink({
    fileSize: params.source.byteLength,
    source: streamOf(params.source, params.piece ?? 3),
    offset: params.offset,
    patch: params.patch,
    chunkSize: params.chunkSize ?? 4,
    write: (chunk) => {
      peak = Math.max(peak, chunk.byteLength)
      chunks.push(chunk.slice())
    },
  })
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { out, peak }
}

async function testMiddlePatchKeepsHeadAndTail(): Promise<void> {
  const { out, peak } = await collectRewrite({
    source: bytesOf(1, 2, 3, 4, 5, 6, 7, 8),
    offset: 3,
    patch: bytesOf(9, 9),
  })
  assert.deepEqual([...out], [1, 2, 3, 9, 9, 6, 7, 8])
  assert.ok(peak <= 4)
}

async function testPrefixAndGrow(): Promise<void> {
  const { out } = await collectRewrite({
    source: bytesOf(1, 2, 3),
    offset: 0,
    patch: bytesOf(8, 8, 8, 8, 8),
  })
  assert.deepEqual([...out], [8, 8, 8, 8, 8])
}

async function testPadThenPatch(): Promise<void> {
  const { out, peak } = await collectRewrite({
    source: bytesOf(1, 2),
    offset: 5,
    patch: bytesOf(7, 7),
    chunkSize: 4,
  })
  assert.deepEqual([...out], [1, 2, 0, 0, 0, 7, 7])
  assert.ok(peak <= 4)
}

async function testCopyStreamDoesNotAssemble(): Promise<void> {
  const source = bytesOf(1, 2, 3, 4, 5, 6)
  const chunks: number[] = []
  let peak = 0
  await copyStreamToSink(streamOf(source, 2), (chunk) => {
    peak = Math.max(peak, chunk.byteLength)
    chunks.push(...chunk)
  })
  assert.deepEqual(chunks, [1, 2, 3, 4, 5, 6])
  assert.equal(peak, 2)
}

async function testRejectsNegativeOffset(): Promise<void> {
  await assert.rejects(
    () =>
      rewriteRangeThroughSink({
        fileSize: 4,
        source: streamOf(bytesOf(1, 2, 3, 4), 4),
        offset: -1,
        patch: bytesOf(1),
        write: () => undefined,
      }),
    /offset/,
  )
}

async function run(): Promise<void> {
  await testMiddlePatchKeepsHeadAndTail()
  await testPrefixAndGrow()
  await testPadThenPatch()
  await testCopyStreamDoesNotAssemble()
  await testRejectsNegativeOffset()
  console.log('files-mount-stream-rewrite.test.ts ok')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
