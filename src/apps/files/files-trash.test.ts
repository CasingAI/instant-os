/**
 * 废纸篓容器流转单测：移入 / 恢复 / 清空 / 冲突改名 / 非法目标。
 * 运行：node --experimental-strip-types src/apps/files/files-trash.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { osNowMs } from '../../os/os-clock.ts'
import { filesCreateText, filesStat, filesTrash, filesRestore, filesEmptyTrash } from './files-api.ts'
import {
  createFolderNode,
  estimateNodeMetaBytes,
  newFilesNodeId,
  resetFilesDbForTests,
} from './files-storage.ts'
import type { FilesNode } from './files-types.ts'
import {
  copyNodeTo,
  emptyTrash,
  invalidateFilesVfsPathCaches,
  listDirectory,
  moveNodeTo,
  removeNode,
  resolveNodeByAbsolutePath,
  restoreNode,
  trashNode,
} from './files-vfs.ts'

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

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
  await createFolderNode({ node, metaBytes: estimateNodeMetaBytes(node), nameMode: 'exact' })
  return node
}

async function testTrashBasicFlow(): Promise<void> {
  await resetState()
  const folder = await seedLocalRootFolder('项目')
  await filesCreateText('/user/项目/notes.txt', 'hello')

  const node = await filesStat('/user/项目/notes.txt')
  assert.ok(node)

  const trashed = await trashNode(folder.id)
  assert.equal(trashed.locationId, 'trash')
  assert.equal(trashed.name, '项目')
  assert.deepEqual(trashed.trashOrigin, { locationId: 'local', parentId: undefined, name: '项目' })

  // 原路径消失，废纸篓根可见
  assert.equal(await filesStat('/user/项目'), undefined)
  const trashRoot = await listDirectory('trash', undefined)
  assert.deepEqual(trashRoot.map((item) => item.name), ['项目'])

  // 文件夹内容随根节点一起保留（元数据级移动，子树未拆）
  const child = await filesStat('/trash/项目/notes.txt')
  assert.ok(child)
  console.log('ok: trash basic flow')
}

async function testTrashNameConflictGetsSuffix(): Promise<void> {
  await resetState()
  const folder = await seedLocalRootFolder('子')
  await filesCreateText('/user/data.txt', '1')
  await filesCreateText('/user/子/data.txt', '2')

  await trashNode((await resolveNodeByAbsolutePath('/user/data.txt'))!.id)
  const second = await trashNode((await resolveNodeByAbsolutePath('/user/子/data.txt'))!.id)
  assert.equal(second.name, 'data 2.txt')
  // 原位置记录保留原名
  assert.deepEqual(second.trashOrigin, {
    locationId: 'local',
    parentId: folder.id,
    name: 'data.txt',
  })
  console.log('ok: trash name conflict suffix')
}

async function testRestoreBackToOrigin(): Promise<void> {
  await resetState()
  const folder = await seedLocalRootFolder('文稿')
  await filesCreateText('/user/文稿/readme.md', '# hi')
  const node = (await resolveNodeByAbsolutePath('/user/文稿/readme.md'))!

  await trashNode(node.id)
  assert.equal(await filesStat('/user/文稿/readme.md'), undefined)

  const restored = await restoreNode((await resolveNodeByAbsolutePath('/trash/readme.md'))!.id)
  assert.equal(restored.locationId, 'local')
  assert.equal(restored.trashOrigin, undefined)
  assert.ok(await filesStat('/user/文稿/readme.md'))
  assert.equal(await filesStat('/trash/readme.md'), undefined)
  console.log('ok: restore back to origin')
}

async function testRestoreConflictGetsSuffix(): Promise<void> {
  await resetState()
  await filesCreateText('/user/notes.txt', 'orig')
  await filesCreateText('/user/tmp.txt', 'trash-me')
  await trashNode((await resolveNodeByAbsolutePath('/user/tmp.txt'))!.id)

  // 恢复前在原位置新建同名文件
  await filesCreateText('/user/tmp.txt', 'new')

  const restored = await restoreNode((await resolveNodeByAbsolutePath('/trash/tmp.txt'))!.id)
  assert.equal(restored.name, 'tmp 2.txt')
  assert.equal(restored.locationId, 'local')
  console.log('ok: restore conflict suffix')
}

async function testRestoreWhenParentGoneFallsBackToVolumeRoot(): Promise<void> {
  await resetState()
  const folder = await seedLocalRootFolder('临时夹')
  await filesCreateText('/user/临时夹/x.txt', 'x')
  const node = (await resolveNodeByAbsolutePath('/user/临时夹/x.txt'))!
  await trashNode(node.id)

  // 原父目录也被删除（移入废纸篓）→ 恢复时父目录不存在
  await trashNode(folder.id)

  const restored = await restoreNode((await resolveNodeByAbsolutePath('/trash/x.txt'))!.id)
  assert.equal(restored.locationId, 'local')
  assert.equal(restored.parentId, undefined)
  assert.ok(await filesStat('/user/x.txt'))
  console.log('ok: restore falls back to volume root')
}

async function testTrashCannotRestoreNonTrashNode(): Promise<void> {
  await resetState()
  await filesCreateText('/user/plain.txt', 'p')
  await assert.rejects(async () => {
    const node = (await resolveNodeByAbsolutePath('/user/plain.txt'))!
    await restoreNode(node.id)
  }, /不在废纸篓/)
  console.log('ok: restore rejects non-trash node')
}

async function testEmptyTrashRemovesEverything(): Promise<void> {
  await resetState()
  await filesCreateText('/user/del1.txt', '1')
  await filesCreateText('/user/del2.txt', '2')
  await trashNode((await resolveNodeByAbsolutePath('/user/del1.txt'))!.id)
  await trashNode((await resolveNodeByAbsolutePath('/user/del2.txt'))!.id)

  await emptyTrash()
  const trashRoot = await listDirectory('trash', undefined)
  assert.equal(trashRoot.length, 0)
  console.log('ok: empty trash')
}

async function testCopyAndMoveToTrashRejected(): Promise<void> {
  await resetState()
  await filesCreateText('/user/keep.txt', 'k')
  const node = (await resolveNodeByAbsolutePath('/user/keep.txt'))!

  await assert.rejects(
    () => copyNodeTo({ sourceId: node.id, destLocationId: 'trash', destParentId: undefined }),
    /不能复制或粘贴到废纸篓/,
  )
  await assert.rejects(
    () => moveNodeTo(node.id, 'trash', undefined),
    /不能移动到废纸篓/,
  )
  // files-api 创建类 API 拒绝 trash 目标
  await assert.rejects(() => filesCreateText('/trash/new.txt', 'x'), /废纸篓/)
  console.log('ok: copy/move/create to trash rejected')
}

async function testTrashWorksThroughFilesApi(): Promise<void> {
  await resetState()
  await filesCreateText('/user/api.txt', 'api')
  const trashed = await filesTrash('/user/api.txt')
  assert.equal(trashed.path, '/trash/api.txt')
  assert.equal(trashed.name, 'api.txt')
  assert.ok(await filesStat('/trash/api.txt'))
  assert.equal(await filesStat('/user/api.txt'), undefined)

  const restored = await filesRestore('/trash/api.txt')
  assert.equal(restored.path, '/user/api.txt')
  assert.ok(await filesStat('/user/api.txt'))

  await filesTrash('/user/api.txt')
  await filesEmptyTrash()
  assert.equal(await filesStat('/trash/api.txt'), undefined)
  console.log('ok: files-api trash surface')
}

async function main(): Promise<void> {
  await testTrashBasicFlow()
  await testTrashNameConflictGetsSuffix()
  await testRestoreBackToOrigin()
  await testRestoreConflictGetsSuffix()
  await testRestoreWhenParentGoneFallsBackToVolumeRoot()
  await testTrashCannotRestoreNonTrashNode()
  await testEmptyTrashRemovesEverything()
  await testCopyAndMoveToTrashRejected()
  await testTrashWorksThroughFilesApi()
  console.log('files-trash tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
