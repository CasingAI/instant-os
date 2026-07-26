/**
 * 系统层 dev 文件夹 ensure 单测。
 * 运行：node --experimental-strip-types src/apps/files/files-system-vfs.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { osNowMs } from '../../os/os-clock.ts'
import { joinFilesAbsolutePath } from './files-path.ts'
import {
  createFolderNode,
  estimateNodeMetaBytes,
  listChildNodes,
  newFilesNodeId,
  resetFilesDbForTests,
} from './files-storage.ts'
import { ensureDevSystemFolder } from './files-system-vfs.ts'
import { invalidateFilesVfsPathCaches, resolveNodeByAbsolutePath } from './files-vfs.ts'

const GITHUB_ROOT = '/dev/github'
const REPO_ROOT = '/dev/github/acme/demo'

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function countDevRootNamed(name: string): Promise<number> {
  const siblings = await listChildNodes('dev', undefined)
  return siblings.filter((child) => child.name === name).length
}

async function testFirstEnsureCreatesSingleFolder(): Promise<void> {
  await resetState()
  await ensureDevSystemFolder(GITHUB_ROOT)
  assert.equal(await countDevRootNamed('github'), 1)
  const node = await resolveNodeByAbsolutePath(GITHUB_ROOT)
  assert.ok(node)
  assert.equal(node?.kind, 'folder')
}

async function testStaleCacheDoesNotDuplicate(): Promise<void> {
  await resetState()
  const missingPath = '/dev/github'
  const cached = await resolveNodeByAbsolutePath(missingPath)
  assert.equal(cached, undefined)

  // 模拟旧 ensureSystemFolder：静默 createFolderNode，不清 VFS 缓存
  const now = osNowMs()
  const silentNode = {
    id: newFilesNodeId(),
    locationId: 'dev' as const,
    parentId: undefined,
    name: 'github',
    kind: 'folder' as const,
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: { readable: true, writable: false },
  }
  await createFolderNode({ node: silentNode, metaBytes: estimateNodeMetaBytes(silentNode) })

  await ensureDevSystemFolder(GITHUB_ROOT)
  assert.equal(await countDevRootNamed('github'), 1)
  await ensureDevSystemFolder(GITHUB_ROOT)
  assert.equal(await countDevRootNamed('github'), 1)
}

async function testAttributePatchDoesNotDuplicate(): Promise<void> {
  await resetState()
  await ensureDevSystemFolder(REPO_ROOT, { readable: true, writable: false })
  assert.equal(await countDevRootNamed('github'), 1)
  const github = await resolveNodeByAbsolutePath(GITHUB_ROOT)
  assert.ok(github)
  const owners = await listChildNodes('dev', github.id)
  assert.equal(owners.filter((child) => child.name === 'acme').length, 1)

  await ensureDevSystemFolder(REPO_ROOT, { readable: true, writable: true })
  const repo = await resolveNodeByAbsolutePath(REPO_ROOT)
  assert.ok(repo)
  assert.equal(repo?.attributes.writable, true)
  assert.equal(await countDevRootNamed('github'), 1)

  const ownersAfter = await listChildNodes('dev', github.id)
  assert.equal(ownersAfter.filter((child) => child.name === 'acme').length, 1)
  const repoSiblings = await listChildNodes(
    'dev',
    ownersAfter.find((child) => child.name === 'acme')?.id,
  )
  assert.equal(repoSiblings.filter((child) => child.name === 'demo').length, 1)
}

async function testNestedEnsureUsesSiblingLookup(): Promise<void> {
  await resetState()
  await ensureDevSystemFolder(joinFilesAbsolutePath(GITHUB_ROOT, 'owner', 'repo'), {
    readable: true,
    writable: true,
  })
  assert.equal(await countDevRootNamed('github'), 1)
  const github = await resolveNodeByAbsolutePath(GITHUB_ROOT)
  assert.ok(github)
  const owners = await listChildNodes('dev', github.id)
  assert.equal(owners.filter((child) => child.name === 'owner').length, 1)
}

async function run(): Promise<void> {
  await testFirstEnsureCreatesSingleFolder()
  await testStaleCacheDoesNotDuplicate()
  await testAttributePatchDoesNotDuplicate()
  await testNestedEnsureUsesSiblingLookup()
  console.log('files-system-vfs.test.ts: ok')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
