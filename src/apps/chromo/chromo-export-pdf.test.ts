/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-export-pdf.test.ts
 */
import assert from 'node:assert/strict'
import { jpegBytesToPdf } from './chromo-export-pdf.ts'

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1')
}

function testJpegWrapsAsPdf(): void {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x01, 0x02])
  const pdf = jpegBytesToPdf(jpeg, 800, 600)
  const text = latin1(pdf)
  assert.ok(text.startsWith('%PDF'))
  assert.ok(text.includes('/DCTDecode'))
  assert.ok(text.includes('/Width 800'))
  assert.ok(text.includes('/Height 600'))
  assert.ok(text.includes('%%EOF'))
  console.log('ok: jpeg wraps as pdf')
}

function testRejectsNonJpeg(): void {
  assert.throws(() => jpegBytesToPdf(Uint8Array.from([0x89, 0x50, 0x4e]), 10, 10), /JPEG/)
  console.log('ok: reject non-jpeg')
}

testJpegWrapsAsPdf()
testRejectsNonJpeg()
console.log('chromo-export-pdf tests passed')
