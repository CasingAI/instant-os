/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-download-filename.test.ts
 */
import assert from 'node:assert/strict'
import {
  parseContentDispositionFilename,
  resolveDownloadFileName,
} from './chromo-download-filename.ts'

function testDisposition(): void {
  assert.equal(parseContentDispositionFilename('attachment; filename="report.pdf"'), 'report.pdf')
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.pdf"),
    '中文.pdf',
  )
  assert.equal(
    parseContentDispositionFilename('attachment; filename="fallback.bin"; filename*=UTF-8\'\'hi.txt'),
    'hi.txt',
  )
  assert.equal(parseContentDispositionFilename('inline'), undefined)
  console.log('ok: content-disposition filename')
}

function testResolveName(): void {
  assert.equal(
    resolveDownloadFileName({
      hinted: 'from-attr.bin',
      url: 'https://example.com/ignored.pdf',
    }),
    'from-attr.bin',
  )
  assert.equal(
    resolveDownloadFileName({
      disposition: 'attachment; filename="server.zip"',
      url: 'https://example.com/path',
    }),
    'server.zip',
  )
  assert.equal(
    resolveDownloadFileName({
      url: 'https://cdn.example.com/files/photo.jpeg?w=2',
    }),
    'photo.jpeg',
  )
  assert.equal(
    resolveDownloadFileName({
      url: 'https://example.com/download',
      mime: 'application/pdf',
    }),
    'download.pdf',
  )
  assert.equal(
    resolveDownloadFileName({
      url: 'https://example.com/',
    }),
    '未命名',
  )
  console.log('ok: resolve download file name')
}

testDisposition()
testResolveName()
console.log('chromo-download-filename tests passed')
