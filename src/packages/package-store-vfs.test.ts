/**
 * NPM store 命名空间：系统层 ensure 后普通 files API 须能继续建子树。
 * 运行：node --experimental-strip-types src/packages/package-store-vfs.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesMkdir, filesStat } from '../apps/files/files-api.ts'
import { resetFilesDbForTests } from '../apps/files/files-storage.ts'
import {
  invalidateFilesVfsPathCaches,
  listDirectory,
  resolveNodeByAbsolutePath,
} from '../apps/files/files-vfs.ts'
import { DEFAULT_PACKAGE_STORE_ROOT } from './package-store-paths.ts'
import { ensureNpmStoreNamespace } from './package-store-vfs.ts'

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

/** 先污染 /dev 根列表缓存，再 ensure；不得再撞「卷根受保护」 */
async function testEnsureThenMkdirUnderStore(): Promise<void> {
  await resetState()

  // 负缓存：list /dev 根 + resolve 缺失的 /dev/npm
  await listDirectory('dev', undefined)
  const missing = await resolveNodeByAbsolutePath(DEFAULT_PACKAGE_STORE_ROOT)
  assert.equal(missing, undefined)

  await ensureNpmStoreNamespace()

  const store = await filesStat(DEFAULT_PACKAGE_STORE_ROOT)
  assert.ok(store)
  assert.equal(store?.kind, 'folder')
  assert.equal(store?.writable, true)

  const childPath = `${DEFAULT_PACKAGE_STORE_ROOT}/v1`
  await filesMkdir(childPath)
  const child = await filesStat(childPath)
  assert.ok(child)
  assert.equal(child?.kind, 'folder')
}

async function run(): Promise<void> {
  await testEnsureThenMkdirUnderStore()
  console.log('package-store-vfs.test.ts: ok')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
