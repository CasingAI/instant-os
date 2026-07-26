/**
 * VFS 文本搜索冒烟。
 * 运行：node --experimental-strip-types src/apps/files/vfs-text-search.smoke-test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesCreateText, filesMkdir, filesRemove, filesStat } from './files-api.ts'
import { searchVfsText } from './vfs-text-search.ts'

const ROOT = '/user/vfs-text-search-smoke'

async function resetRoot(): Promise<void> {
  const existing = await filesStat(ROOT)
  if (existing !== undefined) {
    await filesRemove(ROOT)
  }
  await filesMkdir(ROOT)
}

async function testDirectoryRecursive(): Promise<void> {
  await resetRoot()
  await filesMkdir(`${ROOT}/a`)
  await filesMkdir(`${ROOT}/a/b`)
  await filesCreateText(`${ROOT}/a/b/deep.ts`, 'export const deepToken = 1\n')
  await filesCreateText(`${ROOT}/top.ts`, 'export const topToken = 2\n')

  const deep = await searchVfsText({ query: 'deepToken', rootPath: ROOT })
  assert.equal(deep.matches.length, 1)
  assert.equal(deep.matches[0]?.path, `${ROOT}/a/b/deep.ts`)
  assert.equal(deep.matches[0]?.line, 1)

  const both = await searchVfsText({ query: 'Token', rootPath: ROOT })
  assert.ok(both.matches.length >= 2)
  console.log('ok: directory recursive search')
}

async function testSingleFile(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/only.ts`, 'alpha\nsingleFileNeedle\nomega\n')
  await filesCreateText(`${ROOT}/other.ts`, 'singleFileNeedle should not match if scoped\n')

  const result = await searchVfsText({
    query: 'singleFileNeedle',
    rootPath: `${ROOT}/only.ts`,
  })
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]?.path, `${ROOT}/only.ts`)
  assert.equal(result.matches[0]?.line, 2)
  console.log('ok: single file search')
}

async function testGitignoreSkip(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/.gitignore`, 'ignored/\n')
  await filesMkdir(`${ROOT}/ignored`)
  await filesCreateText(`${ROOT}/ignored/secret.ts`, 'export const gitignoreNeedle = 1\n')
  await filesCreateText(`${ROOT}/visible.ts`, 'export const gitignoreNeedle = 2\n')

  const result = await searchVfsText({
    query: 'gitignoreNeedle',
    rootPath: ROOT,
    useExcludeSettingsAndIgnoreFiles: true,
  })
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]?.path, `${ROOT}/visible.ts`)
  console.log('ok: gitignore skip')
}

async function testTruncated(): Promise<void> {
  await resetRoot()
  const lines = Array.from({ length: 10 }, (_, i) => `const truncToken_${i} = ${i}`).join('\n')
  await filesCreateText(`${ROOT}/many.ts`, `${lines}\n`)

  const result = await searchVfsText({
    query: 'truncToken_',
    rootPath: ROOT,
    maxMatches: 3,
  })
  assert.equal(result.matches.length, 3)
  assert.equal(result.truncated, true)
  console.log('ok: truncated maxMatches')
}

async function main(): Promise<void> {
  await testDirectoryRecursive()
  await testSingleFile()
  await testGitignoreSkip()
  await testTruncated()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
