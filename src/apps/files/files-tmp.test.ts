/**
 * `/tmp` 卷路径与清理单测。
 * 运行：node --experimental-strip-types src/apps/files/files-tmp.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { DATA_CAPACITY_BYTES } from '../../os/device-data-storage.ts'
import { QUICKJS_DEFAULT_MAX_FILE_BYTES } from '../../quickjs/quickjs-quotas.ts'
import { parseFilesAbsolutePath } from './files-path.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import {
  clearTmpCreatedBefore,
  ensureTmpSessionDir,
  fnv1a32Hex,
  isUnderTmpPath,
  npmRunTmpDir,
  terminalTmpDir,
  workspaceAppTmpDir,
  workspaceTmpRoot,
} from './files-tmp.ts'
import { invalidateFilesVfsPathCaches, resolveNodeByAbsolutePath } from './files-vfs.ts'
import { filesCreateText, filesStat } from './files-api.ts'

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function testPathParsing(): Promise<void> {
  const parsed = parseFilesAbsolutePath('/tmp/Terminal/abc/out.txt')
  assert.ok(parsed)
  assert.equal(parsed?.locationId, 'tmp')
  assert.deepEqual(parsed?.segments, ['Terminal', 'abc', 'out.txt'])
  assert.equal(isUnderTmpPath('/tmp'), true)
  assert.equal(isUnderTmpPath('/tmp/Terminal/x'), true)
  assert.equal(isUnderTmpPath('/user/a'), false)
  assert.equal(terminalTmpDir('sess-1'), '/tmp/Terminal/sess-1')
  assert.equal(npmRunTmpDir('run-1'), '/tmp/Npm/run-1')
  console.log('ok: tmp path parsing')
}

async function testEnsureAndClear(): Promise<void> {
  await resetState()
  const dir = terminalTmpDir('old-sess')
  await ensureTmpSessionDir(dir)
  await filesCreateText(`${dir}/spill.txt`, 'hello')
  assert.ok(await filesStat(`${dir}/spill.txt`))

  // 伪造「启动前」：用极大 cutoff 清掉全部
  const result = await clearTmpCreatedBefore(Date.now() + 60_000)
  assert.ok(result.deletedRoots >= 1)
  assert.equal(await resolveNodeByAbsolutePath(dir), undefined)
  console.log('ok: tmp ensure + clearTmpCreatedBefore')
}

async function testWorkspaceContainer(): Promise<void> {
  // FNV-1a 确定性
  const h1 = fnv1a32Hex('/dev/github/CasingAI/instant-os')
  const h2 = fnv1a32Hex('/dev/github/CasingAI/instant-os')
  assert.equal(h1, h2)
  assert.match(h1, /^[0-9a-f]{8}$/)

  // 不同路径不同 hash
  const h3 = fnv1a32Hex('/dev/github/CasingAI/instant-os')
  const h4 = fnv1a32Hex('/dev/github/google/gemini')
  assert.notEqual(h3, h4)

  // workspace 容器路径
  const root = workspaceTmpRoot('/dev/github/CasingAI/instant-os')
  assert.ok(root.startsWith('/tmp/Workspace/'))
  assert.equal(root, `/tmp/Workspace/${fnv1a32Hex('/dev/github/CasingAI/instant-os')}`)

  // 应用分区 + sanitize
  const app = workspaceAppTmpDir('/dev/github/CasingAI/instant-os', 'vscode')
  assert.equal(app, `${root}/vscode`)
  const ext = workspaceAppTmpDir('/dev/github/CasingAI/instant-os', 'ext:foo')
  assert.equal(ext, `${root}/ext-foo`)

  // 尾斜杠归一化
  assert.equal(workspaceTmpRoot('/dev/github/CasingAI/instant-os/'), root)
  console.log('ok: workspace tmp container paths')
}

async function testQuotaConstant(): Promise<void> {
  assert.equal(QUICKJS_DEFAULT_MAX_FILE_BYTES, DATA_CAPACITY_BYTES)
  console.log('ok: maxFileBytes === DATA_CAPACITY_BYTES')
}

async function main(): Promise<void> {
  await testPathParsing()
  await testEnsureAndClear()
  await testWorkspaceContainer()
  await testQuotaConstant()
  console.log('files-tmp tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
