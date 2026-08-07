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
  assert.equal(result.truncatedReason, 'maxMatches')
  console.log('ok: truncated maxMatches')
}

async function testMaxFilesTruncated(): Promise<void> {
  await resetRoot()
  for (let i = 0; i < 12; i += 1) {
    await filesCreateText(`${ROOT}/f${i}.ts`, `export const fileCapNeedle_${i} = ${i}\n`)
  }

  const result = await searchVfsText({ query: 'fileCapNeedle', rootPath: ROOT, maxFiles: 5 })
  assert.equal(result.filesToScan, 5)
  assert.equal(result.truncated, true)
  assert.equal(result.truncatedReason, 'maxFiles')
  assert.equal(result.matches.length, 5)
  console.log('ok: truncated maxFiles')
}

async function testMaxDepthTruncated(): Promise<void> {
  await resetRoot()
  await filesMkdir(`${ROOT}/a`)
  await filesMkdir(`${ROOT}/a/b`)
  await filesCreateText(`${ROOT}/a/b/deep.ts`, 'export const depthCapNeedle = 1\n')

  const result = await searchVfsText({ query: 'depthCapNeedle', rootPath: ROOT, maxDepth: 1 })
  assert.equal(result.matches.length, 0)
  assert.equal(result.truncated, true)
  assert.equal(result.truncatedReason, 'maxDepth')
  console.log('ok: truncated maxDepth')
}

async function testMaxFileBytesSkip(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/big.ts`, `const bigByteNeedle = 1\n${'x'.repeat(4000)}\n`)
  await filesCreateText(`${ROOT}/small.ts`, 'const smallByteNeedle = 1\n')

  const result = await searchVfsText({
    query: 'ByteNeedle',
    rootPath: ROOT,
    maxFileBytes: 1000,
  })
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]?.path, `${ROOT}/small.ts`)
  // 本地卷大文件在收集阶段即被 byteSize 预筛跳过（挂载卷则由读取时的 size 探测兜底）
  assert.equal(result.filesToScan, 1)
  assert.equal(result.scannedFiles, 1)
  // 超出大小上限不算截断
  assert.equal(result.truncated, false)
  console.log('ok: maxFileBytes skip')
}

async function testNoExcludes(): Promise<void> {
  await resetRoot()
  await filesMkdir(`${ROOT}/node_modules`)
  await filesMkdir(`${ROOT}/node_modules/pkg`)
  await filesCreateText(
    `${ROOT}/node_modules/pkg/index.js`,
    'export const excludeToggleNeedle = 1\n',
  )
  await filesCreateText(`${ROOT}/.gitignore`, 'ignored/\n')
  await filesMkdir(`${ROOT}/ignored`)
  await filesCreateText(`${ROOT}/ignored/secret.ts`, 'export const excludeToggleNeedle = 2\n')

  const excluded = await searchVfsText({ query: 'excludeToggleNeedle', rootPath: ROOT })
  assert.equal(excluded.matches.length, 0)

  const included = await searchVfsText({
    query: 'excludeToggleNeedle',
    rootPath: ROOT,
    useExcludeSettingsAndIgnoreFiles: false,
  })
  assert.equal(included.matches.length, 2)
  console.log('ok: useExcludeSettingsAndIgnoreFiles false')
}

async function testFilesToExclude(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/keep.ts`, 'export const excludeGlobNeedle = 1\n')
  await filesCreateText(`${ROOT}/skip.ts`, 'export const excludeGlobNeedle = 2\n')

  const result = await searchVfsText({
    query: 'excludeGlobNeedle',
    rootPath: ROOT,
    filesToExclude: '**/skip.ts',
  })
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]?.path, `${ROOT}/keep.ts`)
  console.log('ok: filesToExclude')
}

async function testContextLines(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/ctx.ts`, 'line1\nctxNeedleLine\nline3\n')

  const result = await searchVfsText({
    query: 'ctxNeedleLine',
    rootPath: ROOT,
    contextLines: 1,
  })
  assert.equal(result.matches.length, 1)
  assert.deepEqual(result.matches[0]?.context, [
    { line: 1, text: 'line1', isMatch: false },
    { line: 2, text: 'ctxNeedleLine', isMatch: true },
    { line: 3, text: 'line3', isMatch: false },
  ])
  console.log('ok: contextLines')
}

async function testHiddenDirSkip(): Promise<void> {
  await resetRoot()
  await filesMkdir(`${ROOT}/.hidden`)
  await filesCreateText(`${ROOT}/.hidden/secret.ts`, 'export const hiddenDirNeedle = 1\n')
  await filesCreateText(`${ROOT}/visible.ts`, 'export const hiddenDirNeedle = 2\n')

  const excluded = await searchVfsText({ query: 'hiddenDirNeedle', rootPath: ROOT })
  assert.equal(excluded.matches.length, 1)
  assert.equal(excluded.matches[0]?.path, `${ROOT}/visible.ts`)

  const included = await searchVfsText({
    query: 'hiddenDirNeedle',
    rootPath: ROOT,
    useExcludeSettingsAndIgnoreFiles: false,
  })
  assert.equal(included.matches.length, 2)
  console.log('ok: hidden dir skip')
}

async function testHiddenFileSkip(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/.env`, 'HIDDEN_FILE_NEEDLE=1\n')
  await filesCreateText(`${ROOT}/visible.ts`, 'export const visibleNeedle = 1\n')

  const excluded = await searchVfsText({ query: 'HIDDEN_FILE_NEEDLE', rootPath: ROOT })
  assert.equal(excluded.matches.length, 0)

  const included = await searchVfsText({
    query: 'HIDDEN_FILE_NEEDLE',
    rootPath: ROOT,
    useExcludeSettingsAndIgnoreFiles: false,
  })
  assert.equal(included.matches.length, 1)
  assert.equal(included.matches[0]?.path, `${ROOT}/.env`)
  console.log('ok: hidden file skip')
}

async function testIncludeTotalCount(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/a.ts`, 'export const a = 1\n')
  await filesCreateText(`${ROOT}/b.ts`, 'export const b = 1\n')
  await filesMkdir(`${ROOT}/sub`)
  await filesCreateText(`${ROOT}/sub/c.ts`, 'export const c = 1\n')

  const counted = await searchVfsText({
    query: 'definitelyMissingXYZ',
    rootPath: ROOT,
    includeTotalCount: true,
  })
  assert.equal(counted.totalFiles, 3)

  const notCounted = await searchVfsText({ query: 'definitelyMissingXYZ', rootPath: ROOT })
  assert.equal(notCounted.totalFiles, undefined)
  console.log('ok: includeTotalCount')
}

async function testTimeout(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/a.ts`, 'const timeoutNeedle = 1\n')
  await filesCreateText(`${ROOT}/b.ts`, 'const timeoutNeedle = 2\n')

  // 不传 timeoutMs：正常完成
  const full = await searchVfsText({ query: 'timeoutNeedle', rootPath: ROOT })
  assert.equal(full.truncated, false)
  assert.equal(full.matches.length, 2)

  // 用可控假时钟推进越过 deadline，确定性触发 timeout（不依赖真实计时）
  const realNow = performance.now
  let fakeNow = 0
  performance.now = () => fakeNow
  try {
    const pending = searchVfsText({
      query: 'timeoutNeedle',
      rootPath: ROOT,
      timeoutMs: 1000,
    })
    fakeNow += 1001 // 搜索开始后、首次 deadline 检查前越过截止
    const timed = await pending
    assert.equal(timed.truncated, true)
    assert.equal(timed.truncatedReason, 'timeout')
  } finally {
    performance.now = realNow
  }
  console.log('ok: timeout')
}

async function testMaxFilesZeroUnlimited(): Promise<void> {
  await resetRoot()
  for (let i = 0; i < 450; i += 1) {
    await filesCreateText(`${ROOT}/f${String(i).padStart(3, '0')}.ts`, `export const f${i} = ${i}\n`)
  }
  await filesCreateText(`${ROOT}/zzNeedle.ts`, 'export const unlimitedNeedle = 1\n')

  // 默认 maxFiles=400：前 400 个文件里没有 needle，zzNeedle 排在第 451 位未被扫描
  const capped = await searchVfsText({ query: 'unlimitedNeedle', rootPath: ROOT })
  assert.equal(capped.matches.length, 0)
  assert.equal(capped.truncated, true)
  assert.equal(capped.truncatedReason, 'maxFiles')
  assert.equal(capped.filesToScan, 400)

  // maxFiles: 0 = 不限制文件数：全部扫到
  const unlimited = await searchVfsText({ query: 'unlimitedNeedle', rootPath: ROOT, maxFiles: 0 })
  assert.equal(unlimited.matches.length, 1)
  assert.equal(unlimited.matches[0]?.path, `${ROOT}/zzNeedle.ts`)
  assert.equal(unlimited.truncated, false)
  assert.equal(unlimited.filesToScan, 451)
  console.log('ok: maxFiles 0 = unlimited')
}

async function main(): Promise<void> {
  await testDirectoryRecursive()
  await testSingleFile()
  await testGitignoreSkip()
  await testTruncated()
  await testMaxFilesTruncated()
  await testMaxDepthTruncated()
  await testMaxFileBytesSkip()
  await testNoExcludes()
  await testFilesToExclude()
  await testContextLines()
  await testHiddenDirSkip()
  await testHiddenFileSkip()
  await testIncludeTotalCount()
  await testTimeout()
  await testMaxFilesZeroUnlimited()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
