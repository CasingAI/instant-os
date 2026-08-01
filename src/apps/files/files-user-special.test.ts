/**
 * `/user` 特殊文件夹 ensure / 保护单测。
 * 运行：node --experimental-strip-types src/apps/files/files-user-special.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { osNowMs } from '../../os/os-clock.ts'
import { filesCreateText, filesRemove, filesRename, filesStat } from './files-api.ts'
import {
  createFolderNode,
  estimateNodeMetaBytes,
  newFilesNodeId,
  resetFilesDbForTests,
} from './files-storage.ts'
import type { FilesNode } from './files-types.ts'
import {
  USER_SPECIAL_FOLDER_NAMES,
  USER_SPECIAL_FOLDER_PATHS,
  ensureUserSpecialFolders,
  isUserSpecialFolderNode,
  isUserSpecialFolderPath,
  userSpecialFolderPath,
} from './files-user-special.ts'
import {
  invalidateFilesVfsPathCaches,
  listDirectory,
  removeNode,
  renameNode,
  resolveNodeByAbsolutePath,
} from './files-vfs.ts'

async function seedLocalRootFolder(name: string): Promise<FilesNode> {
  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: 'local',
    parentId: undefined,
    name,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: { readable: true, writable: true },
  }
  await createFolderNode({ node, metaBytes: estimateNodeMetaBytes(node) })
  return node
}

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function testPathHelpers(): Promise<void> {
  assert.equal(userSpecialFolderPath('Downloads'), '/user/Downloads')
  assert.equal(isUserSpecialFolderPath('/user/Downloads'), true)
  assert.equal(isUserSpecialFolderPath('/user/Musics'), true)
  assert.equal(isUserSpecialFolderPath('/user/Pictures'), true)
  assert.equal(isUserSpecialFolderPath('/user/Downloads/a'), false)
  assert.equal(isUserSpecialFolderPath('/user/Other'), false)
  assert.equal(isUserSpecialFolderPath('/dev/Downloads'), false)
  console.log('ok: path helpers')
}

async function testEnsureCreatesAndReuses(): Promise<void> {
  await resetState()
  const first = await ensureUserSpecialFolders()
  assert.equal(first.length, 3)
  for (const path of USER_SPECIAL_FOLDER_PATHS) {
    const node = await resolveNodeByAbsolutePath(path)
    assert.ok(node)
    assert.equal(node?.kind, 'folder')
    assert.ok(node && isUserSpecialFolderNode(node))
  }

  const second = await ensureUserSpecialFolders()
  assert.deepEqual(
    second.map((node) => node.id).sort(),
    first.map((node) => node.id).sort(),
  )
  console.log('ok: ensure creates and reuses')
}

async function testExistingFolderBecomesProtected(): Promise<void> {
  await resetState()
  // 绕过 listDirectory（会 ensure），模拟用户事先建好的同名文件夹
  const seeded = await seedLocalRootFolder('Downloads')
  await filesCreateText('/user/Downloads/note.txt', 'hi')

  await ensureUserSpecialFolders()
  const after = await resolveNodeByAbsolutePath('/user/Downloads')
  assert.equal(after?.id, seeded.id)
  assert.ok(await filesStat('/user/Downloads/note.txt'))

  await assert.rejects(() => renameNode(after!.id, 'Downloads-renamed'), /受保护/)
  await assert.rejects(() => removeNode(after!.id), /受保护/)
  await assert.rejects(() => filesRename('/user/Downloads', 'x'), /受保护/)
  await assert.rejects(() => filesRemove('/user/Downloads'), /受保护/)

  // 内容仍可写
  await filesCreateText('/user/Downloads/more.txt', 'ok')
  assert.ok(await filesStat('/user/Downloads/more.txt'))
  console.log('ok: existing folder protected; contents writable')
}

async function testListDirectoryEnsures(): Promise<void> {
  await resetState()
  const listed = await listDirectory('local', undefined)
  const names = new Set(listed.map((node) => node.name))
  for (const name of USER_SPECIAL_FOLDER_NAMES) {
    assert.ok(names.has(name), `missing ${name}`)
  }
  console.log('ok: listDirectory ensures special folders')
}

async function main(): Promise<void> {
  await testPathHelpers()
  await testEnsureCreatesAndReuses()
  await testExistingFolderBecomesProtected()
  await testListDirectoryEnsures()
  console.log('files-user-special tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
