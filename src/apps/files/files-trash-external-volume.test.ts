/**
 * 外接卷禁止移入废纸篓单测：磁盘镜像（image:*）与挂载文件夹（mount:*）节点
 * 调用 trashNode 直接抛错（须走永久删除）；内部卷软删路径不受影响。
 * 运行：node --experimental-strip-types src/apps/files/files-trash-external-volume.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { osNowMs } from '../../os/os-clock.ts'
import { filesCreateText, filesStat } from './files-api.ts'
import {
  createFolderNode,
  estimateNodeMetaBytes,
  newFilesNodeId,
  resetFilesDbForTests,
} from './files-storage.ts'
import type { FilesLocationId, FilesNode } from './files-types.ts'
import {
  invalidateFilesVfsPathCaches,
  resolveNodeByAbsolutePath,
  trashNode,
} from './files-vfs.ts'

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

/** 在指定卷根下种一个文件夹记录（不依赖真实镜像/挂载会话，守卫在会话访问前触发） */
async function seedRootFolderWithLocation(
  locationId: FilesLocationId,
  name: string,
): Promise<FilesNode> {
  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId,
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

async function testTrashRejectsImageVolumeNode(): Promise<void> {
  await resetState()
  const node = await seedRootFolderWithLocation('image:testvol', '镜像资料')
  await assert.rejects(() => trashNode(node.id), /永久删除/)
  console.log('ok: trash rejects image volume node')
}

async function testTrashRejectsMountVolumeNode(): Promise<void> {
  await resetState()
  const node = await seedRootFolderWithLocation('mount:testusb', '外接盘资料')
  await assert.rejects(() => trashNode(node.id), /永久删除/)
  console.log('ok: trash rejects mount volume node')
}

async function testInternalVolumeTrashStillWorks(): Promise<void> {
  await resetState()
  await filesCreateText('/user/local-note.txt', 'keep me')
  const node = (await resolveNodeByAbsolutePath('/user/local-note.txt'))!
  const trashed = await trashNode(node.id)
  assert.equal(trashed.locationId, 'trash')
  assert.equal(await filesStat('/user/local-note.txt'), undefined)
  assert.ok(await filesStat('/trash/local-note.txt'))
  console.log('ok: internal volume trash unaffected')
}

async function main(): Promise<void> {
  await testTrashRejectsImageVolumeNode()
  await testTrashRejectsMountVolumeNode()
  await testInternalVolumeTrashStillWorks()
  console.log('files-trash-external-volume tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
