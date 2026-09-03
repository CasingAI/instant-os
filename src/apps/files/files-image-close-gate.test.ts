/**
 * 推出门控单测：
 * - beginClose 之后新任务一律拒绝（拷贝响亮失败，不再静默丢数据），已完成的写入不受影响
 * - close 排空在途任务、刷残脏、关 IO；pendingWorkCount 归零，已提交内容真实落盘
 * - exFAT 卷同一套门控
 * 运行：node --experimental-strip-types src/apps/files/files-image-close-gate.test.ts
 */
import assert from 'node:assert/strict'
import { createFat12Image } from './files-image-fat12-fixture.ts'
import { createExfatImage } from './files-image-exfat-fixture.ts'
import {
  FatImageVolume,
  type ImageDiskIo,
} from './files-image-fat-volume.ts'
import { ExfatImageVolume } from './files-image-exfat-volume.ts'
import { IMAGE_VOLUME_CLOSING_ERROR } from './files-image-volume.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 内存盘 + 慢速写/关闭计数：counters 是可变对象，闭包内自增可被外部读到 */
function slowWriteMemoryDisk(bytes: Uint8Array, writeDelayMs: number): {
  io: ImageDiskIo
  counters: { writes: number; closed: number }
} {
  const counters = { writes: 0, closed: 0 }
  return {
    counters,
    io: {
      size: bytes.byteLength,
      async read(offset, length) {
        return bytes.slice(offset, offset + length)
      },
      async write(offset, data) {
        counters.writes += 1
        await delay(writeDelayMs)
        bytes.set(data, offset)
      },
      async close() {
        counters.closed += 1
      },
    },
  }
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${what}`)
    await delay(2)
  }
}

/** 重新挂载已写过的内存镜像，读出文件内容 */
function rereadFatVolume(image: Uint8Array): FatImageVolume {
  return new FatImageVolume({
    size: image.byteLength,
    async read(offset, length) {
      return image.slice(offset, offset + length)
    },
    async write() {},
  })
}

async function testCompletedWritesPersistAndGateRejectsNewWork(): Promise<void> {
  const image = createFat12Image()
  const state = slowWriteMemoryDisk(image, 2)
  const volume = new FatImageVolume(state.io)
  await volume.prepare()
  // 推出前已完成的写入：应完整落盘
  await volume.writeFile('done.txt', encoder.encode('done-content'))

  volume.beginClose()
  // 门控后新任务直接拒绝，错误文案明确；pendingWork 不因拒绝增加
  const pendingAfterGate = volume.pendingWorkCount
  await assert.rejects(
    () => volume.writeFile('late.txt', encoder.encode('late')),
    (error: unknown) => {
      assert.equal(error instanceof Error && error.message, IMAGE_VOLUME_CLOSING_ERROR)
      return true
    },
  )
  assert.equal(volume.pendingWorkCount, pendingAfterGate)

  // close：排空 + 刷残脏 + 关 IO
  await volume.close()
  assert.equal(volume.pendingWorkCount, 0)
  assert.equal(state.counters.closed, 1)
  assert.ok(state.counters.writes >= 1, `writes=${state.counters.writes}`)

  // 已提交内容可读回，门控后拒绝的任务不存在
  const reread = rereadFatVolume(image)
  await reread.prepare()
  assert.equal(decoder.decode(await reread.readFile('done.txt')), 'done-content')
  await assert.rejects(() => reread.readFile('late.txt'))
  await reread.close()
  console.log('fat completed-writes-persist ok')
}

async function testCloseDrainsInFlightTaskBeforeClosingIo(): Promise<void> {
  const image = createFat12Image()
  const state = slowWriteMemoryDisk(image, 5)
  const volume = new FatImageVolume(state.io, {
    inlineFlushDirtyBytes: 64,
    writeBehindDirtyBytes: 64,
  })
  await volume.prepare()

  // 在途长任务（整簇写入会触发慢速 io.write），close 必须等它跑完
  const writer = await volume.streamWriteFile('big.txt', { isNew: true, expectedSize: 2048 })
  const writesBefore = state.counters.writes
  const writePromise = writer.write(new Uint8Array(2048).fill(0x41))
  await waitFor(() => state.counters.writes > writesBefore, 'in-flight write started')
  assert.ok(volume.pendingWorkCount > 0, '在途任务应计入 pendingWork')

  const closePromise = volume.close()
  await writePromise
  await closePromise
  assert.equal(volume.pendingWorkCount, 0)
  assert.equal(state.counters.closed, 1)
  // 关闭发生在全部在途写入之后
  assert.ok(state.counters.writes > writesBefore, 'close 前在途任务确实落盘过')

  // 在途 write 已整簇消费全部 pending，内容随 close 的排空刷盘落盘
  const reread = rereadFatVolume(image)
  await reread.prepare()
  const got = await reread.readFile('big.txt')
  assert.equal(got.length, 2048)
  assert.equal(got.every((byte) => byte === 0x41), true)
  await reread.close()
  console.log('fat close-drains-inflight ok')
}

async function testExfatGateRejectsAfterClose(): Promise<void> {
  const image = createExfatImage()
  const state = slowWriteMemoryDisk(image, 2)
  const volume = new ExfatImageVolume(state.io)
  await volume.prepare()
  await volume.writeFile('a.txt', encoder.encode('exfat-gate'))
  volume.beginClose()
  await assert.rejects(
    () => volume.writeFile('b.txt', encoder.encode('nope')),
    (error: unknown) => {
      assert.equal(error instanceof Error && error.message, IMAGE_VOLUME_CLOSING_ERROR)
      return true
    },
  )
  await volume.close()
  assert.equal(volume.pendingWorkCount, 0)
  assert.equal(state.counters.closed, 1)
  const reread = new ExfatImageVolume({
    size: image.byteLength,
    async read(offset, length) {
      return image.slice(offset, offset + length)
    },
    async write() {},
  })
  await reread.prepare()
  assert.equal(decoder.decode(await reread.readFile('a.txt')), 'exfat-gate')
  await assert.rejects(() => reread.readFile('b.txt'))
  await reread.close()
  console.log('exfat close-gate ok')
}

await testCompletedWritesPersistAndGateRejectsNewWork()
await testCloseDrainsInFlightTaskBeforeClosingIo()
await testExfatGateRejectsAfterClose()
console.log('files-image-close-gate.test.ts: ok')