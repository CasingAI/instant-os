/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-network-preview.test.ts
 */
import assert from 'node:assert/strict'
import type { ChromoNetworkBodyReadResult, ChromoNetworkEntry } from './chromo-bridge.ts'
import {
  base64ToBytes,
  classifyNetworkPreviewKind,
  isLikelyValidImageBytes,
  isNonPreviewableBinaryBody,
  isPreviewableImageBody,
  latin1StringToBytes,
  networkBodyToBytes,
  networkBodyToImageBlob,
} from './chromo-network-preview.ts'

function entry(partial: Partial<ChromoNetworkEntry> & Pick<ChromoNetworkEntry, 'url'>): ChromoNetworkEntry {
  return {
    id: 'e1',
    ts: 0,
    method: 'GET',
    status: 200,
    type: 'other',
    size: 0,
    duration: 0,
    failed: false,
    bypass: false,
    ...partial,
  }
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i])
  }
  return out
}

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

{
  // latin1 text encoding preserves JPEG high bytes (unlike TextEncoder)
  const latin1 = bytesToLatin1(JPEG_HEADER)
  const decoded = latin1StringToBytes(latin1)
  assert.deepEqual([...decoded], [...JPEG_HEADER])
  assert.ok(isLikelyValidImageBytes(decoded))

  const result: ChromoNetworkBodyReadResult = {
    headers: { 'content-type': 'image/jpeg' },
    body: latin1,
    encoding: 'text',
    status: 200,
  }
  const blob = networkBodyToImageBlob(result, 'image/jpeg')
  assert.equal(blob.type, 'image/jpeg')
  assert.equal(blob.size, JPEG_HEADER.length)
  const fromBody = networkBodyToBytes(result)
  assert.deepEqual([...fromBody], [...JPEG_HEADER])
}

{
  // TextEncoder path would corrupt — document the bug we fixed
  const latin1 = bytesToLatin1(JPEG_HEADER)
  const utf8 = new TextEncoder().encode(latin1)
  assert.notEqual(utf8.length, JPEG_HEADER.length)
  assert.equal(isLikelyValidImageBytes(utf8), false)
}

{
  // type=image + application/octet-stream must NOT be non-previewable binary
  const imageEntry = entry({
    url: 'https://cdn.example.com/974222_240.jpg',
    type: 'image',
  })
  assert.equal(isPreviewableImageBody(imageEntry, 'application/octet-stream'), true)
  assert.equal(isNonPreviewableBinaryBody(imageEntry, 'application/octet-stream'), false)
  assert.equal(classifyNetworkPreviewKind(imageEntry, 'application/octet-stream'), 'image')
}

{
  // URL .jpg extension triggers image even when type is other / no mime
  const byExt = entry({
    url: 'https://cdn.example.com/photos/974222_240.jpg?w=240',
    type: 'other',
  })
  assert.equal(isPreviewableImageBody(byExt), true)
  assert.equal(classifyNetworkPreviewKind(byExt), 'image')
  assert.equal(isNonPreviewableBinaryBody(byExt, 'application/octet-stream'), false)
}

{
  // base64 with whitespace and data-URL prefix still decodes
  const b64 = btoa(bytesToLatin1(PNG_HEADER))
  const wrapped = `data:image/png;base64,\n${b64.slice(0, 8)}\n${b64.slice(8)} `
  const decoded = base64ToBytes(wrapped)
  assert.deepEqual([...decoded], [...PNG_HEADER])
  assert.ok(isLikelyValidImageBytes(decoded))

  const result: ChromoNetworkBodyReadResult = {
    headers: { 'Content-Type': 'image/png' },
    body: wrapped,
    encoding: 'base64',
    status: 200,
  }
  assert.deepEqual([...networkBodyToBytes(result)], [...PNG_HEADER])
}

{
  // gzip magic is not a valid image
  const gzip = new Uint8Array([0x1f, 0x8b, 0x08, 0x00])
  assert.equal(isLikelyValidImageBytes(gzip), false)
}

{
  // font destination remains non-previewable
  const font = entry({ url: 'https://example.com/a.woff2', type: 'font' })
  assert.equal(isNonPreviewableBinaryBody(font), true)
  assert.equal(classifyNetworkPreviewKind(font), 'binary')
}

{
  // sniffImageMime prefers image/* over octet-stream for Blob type
  const result: ChromoNetworkBodyReadResult = {
    headers: { 'content-type': 'application/octet-stream' },
    body: bytesToLatin1(JPEG_HEADER),
    encoding: 'text',
    status: 200,
  }
  const blob = networkBodyToImageBlob(result, 'application/octet-stream')
  assert.equal(blob.type, 'image/jpeg')
}

console.log('chromo-network-preview.test.ts: ok')
