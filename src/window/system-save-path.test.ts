/**
 * 运行：node --experimental-strip-types src/window/system-save-path.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildSaveDialogPath,
  joinSaveFilePath,
  sanitizeSaveFileName,
  splitSuggestedSavePath,
} from './system-save-path.ts'

function testSanitizeSaveFileName(): void {
  assert.equal(sanitizeSaveFileName('Report', 'html'), 'Report.html')
  assert.equal(sanitizeSaveFileName('page.html', 'html'), 'page.html')
  assert.equal(sanitizeSaveFileName('foo/bar.png', 'png'), 'foo_bar.png')
  assert.equal(sanitizeSaveFileName('  ', 'pdf'), 'untitled.pdf')
  assert.equal(sanitizeSaveFileName('...hidden', 'txt'), 'hidden.txt')
  console.log('ok: sanitize save file name')
}

function testJoinAndBuildPath(): void {
  assert.equal(joinSaveFilePath('/user/Downloads', 'page.html'), '/user/Downloads/page.html')
  assert.equal(
    buildSaveDialogPath('/user/Downloads', 'Article', 'html'),
    '/user/Downloads/Article.html',
  )
  assert.equal(
    buildSaveDialogPath('/user/Downloads', 'shot.png', 'png'),
    '/user/Downloads/shot.png',
  )
  console.log('ok: build save dialog path without creating files')
}

function testSplitSuggestedSavePath(): void {
  assert.deepEqual(splitSuggestedSavePath('/user/Downloads'), { folderHint: '/user/Downloads' })
  assert.deepEqual(splitSuggestedSavePath('/user/Downloads/page.html'), {
    folderHint: '/user/Downloads',
    fileName: 'page.html',
  })
  assert.deepEqual(splitSuggestedSavePath('/user/Documents/notes'), {
    folderHint: '/user/Documents/notes',
  })
  console.log('ok: split suggested save path')
}

testSanitizeSaveFileName()
testJoinAndBuildPath()
testSplitSuggestedSavePath()
console.log('system-save-path tests passed')
