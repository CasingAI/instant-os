/**
 * 预览类型判定单测。
 * 运行：node --experimental-strip-types src/preview/preview-kind.test.ts
 */
import assert from 'node:assert/strict'
import {
  fileNameFromPath,
  guessImageMime,
  resolvePreviewKind,
} from './preview-kind.ts'

function test(label: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${label}`)
  } catch (error) {
    console.error(`✗ ${label}`)
    throw error
  }
}

const IMAGE_CASES = [
  { name: 'photo.png', mime: 'image/png' },
  { name: 'photo.jpg', mime: 'image/jpeg' },
  { name: 'photo.jpeg', mime: 'image/jpeg' },
  { name: 'animated.gif', mime: 'image/gif' },
  { name: 'compressed.webp', mime: 'image/webp' },
  { name: 'favicon.ico', mime: 'image/x-icon' },
  { name: 'bitmap.bmp', mime: 'image/bmp' },
]

const UNSUPPORTED_CASES = [
  'archive.zip',
  'sound.mp3',
  'movie.mp4',
  'spreadsheet.xlsx',
  'unknown',
  'noextension',
]

for (const { name, mime } of IMAGE_CASES) {
  test(`resolvePreviewKind('${name}') 识别为 image`, () => {
    assert.equal(resolvePreviewKind(name), 'image')
  })
  test(`guessImageMime('${name}') 返回 '${mime}'`, () => {
    assert.equal(guessImageMime(name), mime)
  })
}

test('resolvePreviewKind 对图片扩展名大小写不敏感', () => {
  assert.equal(resolvePreviewKind('photo.BMP'), 'image')
  assert.equal(resolvePreviewKind('photo.Bmp'), 'image')
  assert.equal(resolvePreviewKind('photo.PNG'), 'image')
})

for (const name of UNSUPPORTED_CASES) {
  test(`resolvePreviewKind('${name}') 识别为 unsupported`, () => {
    assert.equal(resolvePreviewKind(name), 'unsupported')
  })
}

test('fileNameFromPath 能正确提取文件名', () => {
  assert.equal(fileNameFromPath('/home/user/photo.bmp'), 'photo.bmp')
  assert.equal(fileNameFromPath('photo.bmp'), 'photo.bmp')
  assert.equal(fileNameFromPath('folder/'), 'folder')
})
