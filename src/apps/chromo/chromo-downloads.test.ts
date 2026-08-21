/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-downloads.test.ts
 */
import assert from 'node:assert/strict'
import { DEVICE_STORAGE_KEYS } from '../../os/device-storage.ts'
import {
  listChromoDownloads,
  markInterruptedChromoDownloads,
  newChromoDownloadRecord,
  upsertChromoDownload,
} from './chromo-downloads.ts'
import { parseChromoDownloadPayload, parseChromoClickPayload } from '../../page-host/page-bridge.ts'
import { dataUrlToBytes } from './chromo-save-page.ts'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}

;(globalThis as { localStorage?: Storage }).localStorage ??= new MemoryStorage()
;(globalThis as { window?: EventTarget }).window ??= new EventTarget()

function reset(): void {
  localStorage.removeItem(DEVICE_STORAGE_KEYS.chromoDownloads)
}

function testInterruptMarksFailed(): void {
  reset()
  upsertChromoDownload(
    newChromoDownloadRecord({
      id: 'dl-1',
      url: 'https://example.com/a.bin',
      filename: 'a.bin',
      path: '/user/Downloads/a.bin',
    }),
  )
  const paths = markInterruptedChromoDownloads()
  assert.deepEqual(paths, ['/user/Downloads/a.bin'])
  const [item] = listChromoDownloads()
  assert.equal(item?.state, 'failed')
  assert.match(item?.error ?? '', /刷新/)
  console.log('ok: interrupted in-progress marked failed')
}

function testParseClickDownload(): void {
  const parsed = parseChromoClickPayload({
    ts: 1,
    href: 'https://example.com/a.bin',
    download: true,
  })
  assert.equal(parsed?.download, true)
  const named = parseChromoClickPayload({
    href: 'https://example.com/a.bin',
    download: 'named.bin',
  })
  assert.equal(named?.download, 'named.bin')
  console.log('ok: parse VC_CLICK download')
}

function testParseDownloadPayload(): void {
  const parsed = parseChromoDownloadPayload({
    id: 'x',
    url: 'https://example.com/a.pdf',
    filename: 'a.pdf',
    reason: 'content-disposition',
  })
  assert.equal(parsed?.url, 'https://example.com/a.pdf')
  assert.equal(parsed?.reason, 'content-disposition')
  assert.equal(parseChromoDownloadPayload({ filename: 'x' }), undefined)
  console.log('ok: parse VC_DOWNLOAD payload')
}

function testDataUrlDecode(): void {
  const bytes = dataUrlToBytes('data:text/plain,hello')
  assert.equal(new TextDecoder().decode(bytes), 'hello')
  const b64 = dataUrlToBytes('data:text/plain;base64,YQ==')
  assert.equal(new TextDecoder().decode(b64), 'a')
  console.log('ok: data url decodes in system')
}

testInterruptMarksFailed()
testParseDownloadPayload()
testParseClickDownload()
testDataUrlDecode()
console.log('chromo-downloads tests passed')
