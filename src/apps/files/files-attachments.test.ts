/**
 * VFS 原生文件附加：挂在主文件节点上、路径带 .attach 保留段、目录列表不出现、
 * 复制/删除/移动/废纸篓跟随主文件；附加复制一律独立正文；大小/存储统计含附加。
 * 运行：node --experimental-strip-types src/apps/files/files-attachments.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  filesCreateAttachment,
  filesListAttachments,
  filesList,
  filesReadBlob,
  filesStat,
  filesWriteBytesRange,
  filesReadBlobRange,
  filesCreateBinary,
  filesMkdir,
  filesCopy,
  filesRemove,
  filesMove,
  filesRename,
  filesTrash,
  filesRestore,
} from './files-api.ts'
import {
  estimateCopyBytes,
  estimateCopyWorkload,
  estimateDeleteWorkload,
  invalidateFilesVfsPathCaches,
  listSubtreeFiles,
  resolveFileNodeByAbsolutePath,
} from './files-vfs.ts'
import {
  estimateNodeMetaBytes,
  getFilesAttachmentBytes,
  getFileBlobStorageInfo,
  getFilesBytesByLocation,
  listAttachmentNodes,
  resetFilesDbForTests,
  sumAttachmentBytes,
} from './files-storage.ts'
import {
  claimDiskImagePath,
  releaseDiskImagePath,
  resetDiskImageOccupancyForTests,
} from './files-disk-image-occupancy.ts'
import { resetOpfsBlobsForTests, useMemoryOpfsForTests } from './files-opfs-blobs.ts'
import { FILES_ATTACH_SEGMENT } from './files-types.ts'

useMemoryOpfsForTests()

async function resetFiles(): Promise<void> {
  await resetFilesDbForTests()
  await resetOpfsBlobsForTests()
  resetDiskImageOccupancyForTests()
  invalidateFilesVfsPathCaches()
}

async function seed(): Promise<string> {
  await filesCreateBinary('/user/盘.img', new Uint8Array([1, 1, 1, 1]).buffer)
  return '/user/盘.img'
}

async function seedWithAttach(
  attachBytes: ArrayBuffer,
): Promise<{ mainPath: string; mainId: string; attachName: string }> {
  const mainPath = await seed()
  const created = await filesCreateAttachment({
    mainFilePath: mainPath,
    name: '缓存',
    bytes: attachBytes,
    tags: ['vm-disk-cache'],
  })
  const mainNode = await resolveFileNodeByAbsolutePath(mainPath)
  assert.ok(mainNode)
  return { mainPath, mainId: mainNode.id, attachName: created.name }
}

async function volumeBytes(locationId: 'local' | 'dev' | 'tmp' | 'trash'): Promise<number> {
  const entries = await getFilesBytesByLocation([locationId])
  return entries[0]?.bytes ?? 0
}

async function testCreateListAndPathAccess(): Promise<void> {
  await resetFiles()
  const mainPath = await seed()
  const created = await filesCreateAttachment({
    mainFilePath: mainPath,
    name: '虚拟机硬盘缓存',
    bytes: new Uint8Array([9, 9, 9, 9]).buffer,
    tags: ['vm-disk-cache'],
  })
  assert.equal(created.kind, 'file')
  assert.equal(created.attachmentTags?.[0], 'vm-disk-cache')

  // 按标签找得到；不带标签也列得出
  const byTag = await filesListAttachments(mainPath, { tag: 'vm-disk-cache' })
  assert.equal(byTag.length, 1)
  assert.equal(byTag[0]?.name, '虚拟机硬盘缓存')
  assert.equal((await filesListAttachments(mainPath)).length, 1)

  // 路径读写：主文件/.attach/附加名
  const attachPath = `${mainPath}/${FILES_ATTACH_SEGMENT}/${created.name}`
  const stat = await filesStat(attachPath)
  assert.equal(stat?.kind, 'file')
  assert.equal(stat?.byteSize, 4)
  const read = new Uint8Array(await (await filesReadBlob(attachPath)).arrayBuffer())
  assert.deepEqual([...read], [9, 9, 9, 9])
  await filesWriteBytesRange(attachPath, 0, new Uint8Array([7, 7]))
  const after = new Uint8Array(await (await filesReadBlobRange(attachPath, 0, 4)).arrayBuffer())
  assert.deepEqual([...after], [7, 7, 9, 9])
}

async function testAttachmentsHiddenFromDirectoryListing(): Promise<void> {
  await resetFiles()
  const mainPath = await seed()
  await filesCreateAttachment({
    mainFilePath: mainPath,
    name: '缓存',
    bytes: new Uint8Array([0]).buffer,
  })
  const parent = '/user'
  const entries = await filesList(parent)
  // 目录里只有主文件本身；附加不再多出一项普通文件
  assert.equal(entries.filter((entry) => entry.name.includes('盘')).length, 1)
  // 对主文件本身列目录仍当「这是文件」：.attach 虚拟目录可以列
  const attachDir = await filesList(`${mainPath}/${FILES_ATTACH_SEGMENT}`)
  assert.equal(attachDir.length, 1)
  assert.equal(attachDir[0]?.name, '缓存')
}

async function testDeleteReclaimsAttachmentBytesAndNodes(): Promise<void> {
  await resetFiles()
  const { mainPath, mainId } = await seedWithAttach(new Uint8Array([5, 5, 5, 5, 5]).buffer)
  assert.equal(await volumeBytes('local'), 4 + 5)
  assert.equal(await getFilesAttachmentBytes(), 5)

  // 删除主文件：附加随子树一起删
  await filesRemove(mainPath)
  assert.equal(await filesStat(mainPath), undefined)
  // 不能只 stat 附加路径（主文件没了路径必失败，测不出孤儿）——直接查 storage 层
  assert.equal((await listAttachmentNodes('local', mainId)).length, 0)
  assert.equal(await getFilesAttachmentBytes(), 0)
  // 卷字节统计回收了附加字节
  assert.equal(await volumeBytes('local'), 0)
}

async function testTrashCarriesAttachments(): Promise<void> {
  await resetFiles()
  const { mainPath, mainId, attachName } = await seedWithAttach(new Uint8Array([5, 5, 5, 5, 5]).buffer)

  await filesTrash(mainPath)
  // 附加在 trash 卷可列，字节记到 trash 卷
  const inTrash = await listAttachmentNodes('trash', mainId)
  assert.equal(inTrash.length, 1)
  assert.equal(inTrash[0]?.name, attachName)
  assert.equal(await volumeBytes('local'), 0)
  assert.equal(await volumeBytes('trash'), 4 + 5)

  // 恢复后回原卷，路径访问恢复
  await filesRestore(`/trash/${mainPath.slice('/user/'.length)}`)
  assert.equal((await listAttachmentNodes('local', mainId)).length, 1)
  assert.equal(await volumeBytes('local'), 4 + 5)
  assert.equal(await volumeBytes('trash'), 0)
  const stat = await filesStat(`${mainPath}/${FILES_ATTACH_SEGMENT}/${attachName}`)
  assert.equal(stat?.byteSize, 5)
}

async function testRenameKeepsAttachmentsAccessible(): Promise<void> {
  await resetFiles()
  const { attachName } = await seedWithAttach(new Uint8Array([5, 5]).buffer)
  await filesRename('/user/盘.img', '盘2.img')
  const stat = await filesStat(`/user/盘2.img/${FILES_ATTACH_SEGMENT}/${attachName}`)
  assert.equal(stat?.byteSize, 2)
  const read = new Uint8Array(
    await (await filesReadBlob(`/user/盘2.img/${FILES_ATTACH_SEGMENT}/${attachName}`)).arrayBuffer(),
  )
  assert.deepEqual([...read], [5, 5])

  // 同卷移动（复制 + 删除路径）：附加同样跟随，新路径可访问
  await filesMkdir('/user/子目录')
  await filesMove('/user/盘2.img', '/user/子目录')
  const movedStat = await filesStat(`/user/子目录/盘2.img/${FILES_ATTACH_SEGMENT}/${attachName}`)
  assert.equal(movedStat?.byteSize, 2)
  assert.equal(await filesStat(`/user/盘2.img/${FILES_ATTACH_SEGMENT}/${attachName}`), undefined)
}

async function testCrossVolumeMoveCarriesAttachments(): Promise<void> {
  await resetFiles()
  const { mainPath } = await seedWithAttach(new Uint8Array([3, 3, 3]).buffer)
  await filesMove(mainPath, '/tmp')

  // 目标处附加存在且内容一致
  const moved = await filesListAttachments('/tmp/盘.img', { tag: 'vm-disk-cache' })
  assert.equal(moved.length, 1)
  const read = new Uint8Array(
    await (
      await filesReadBlob(`/tmp/盘.img/${FILES_ATTACH_SEGMENT}/${moved[0]!.name}`)
    ).arrayBuffer(),
  )
  assert.deepEqual([...read], [3, 3, 3])

  // 源处无残留（节点 + 配额），附加字节只记一次
  assert.equal(await volumeBytes('local'), 0)
  assert.equal(await volumeBytes('tmp'), 4 + 3)
  assert.equal(await getFilesAttachmentBytes(['local']), 0)
  assert.equal(await getFilesAttachmentBytes(['tmp']), 3)
  assert.equal(await getFilesAttachmentBytes(), 3)
}

async function testCrossVolumeMoveToNonAttachableVolumeRejected(): Promise<void> {
  await resetFiles()
  const { mainPath } = await seedWithAttach(new Uint8Array([5, 5]).buffer)
  // /mount/{键} 卷挂不了附加：跨卷移动（复制+删除）必须拒绝而不是静默丢附加
  await assert.rejects(() => filesMove(mainPath, '/mount/不存在'), /挂着附加.*目标位置不支持/)

  // 文件夹里带附加主文件同样拒绝
  await filesMkdir('/user/箱')
  await filesCreateBinary('/user/箱/盘.img', new Uint8Array([1]).buffer)
  await filesCreateAttachment({
    mainFilePath: '/user/箱/盘.img',
    name: '缓存',
    bytes: new Uint8Array([2, 2]).buffer,
  })
  await assert.rejects(() => filesMove('/user/箱', '/mount/不存在'), /挂着附加.*目标位置不支持/)
}

async function testCopyAttachmentHasIndependentBody(): Promise<void> {
  await resetFiles()
  const { mainPath, attachName } = await seedWithAttach(new Uint8Array([5, 5, 5, 5]).buffer)
  await filesMkdir('/user/子目录')
  const copied = await filesCopy(mainPath, '/user/子目录')

  // 副本附加内容一致；正文独立（blob 不同，共享正文会被安静写入通道串写）
  const copyAttachPath = `/user/子目录/${copied.name}/${FILES_ATTACH_SEGMENT}/${attachName}`
  const sourceAttachPath = `${mainPath}/${FILES_ATTACH_SEGMENT}/${attachName}`
  const copiedRead = new Uint8Array(await (await filesReadBlob(copyAttachPath)).arrayBuffer())
  assert.deepEqual([...copiedRead], [5, 5, 5, 5])
  const sourceAttach = await resolveFileNodeByAbsolutePath(sourceAttachPath)
  const copyAttach = await resolveFileNodeByAbsolutePath(copyAttachPath)
  assert.ok(sourceAttach && copyAttach)
  const sourceInfo = await getFileBlobStorageInfo(sourceAttach.id)
  const copyInfo = await getFileBlobStorageInfo(copyAttach.id)
  assert.ok(sourceInfo && copyInfo)
  assert.notEqual(sourceInfo.blobId, copyInfo.blobId)

  // 直接改源的附加：副本字节与内容都不变
  await filesWriteBytesRange(sourceAttachPath, 0, new Uint8Array([9, 9, 9, 9]))
  const copyStat = await filesStat(copyAttachPath)
  assert.equal(copyStat?.byteSize, 4)
  const after = new Uint8Array(await (await filesReadBlob(copyAttachPath)).arrayBuffer())
  assert.deepEqual([...after], [5, 5, 5, 5])
}

async function testCopyOccupiedDiskImageRejected(): Promise<void> {
  await resetFiles()
  const { mainPath } = await seedWithAttach(new Uint8Array([5, 5]).buffer)
  await filesMkdir('/user/子目录')
  await claimDiskImagePath(mainPath, { kind: 'vm', id: 'vm-attachments-test' })
  try {
    await assert.rejects(() => filesCopy(mainPath, '/user/子目录'), /无法复制.*虚拟机正在使用/)
  } finally {
    releaseDiskImagePath(mainPath, { kind: 'vm', id: 'vm-attachments-test' })
  }
}

async function testAttachmentByteSummaries(): Promise<void> {
  await resetFiles()
  const { mainPath, mainId } = await seedWithAttach(new Uint8Array([5, 5, 5, 5, 5]).buffer)
  await filesCreateAttachment({
    mainFilePath: mainPath,
    name: '缓存2',
    bytes: new Uint8Array([7, 7, 7, 7, 7, 7, 7]).buffer,
  })
  await filesCreateBinary('/user/裸文件.img', new Uint8Array([1]).buffer)
  const bareNode = await resolveFileNodeByAbsolutePath('/user/裸文件.img')
  assert.ok(bareNode)

  // 批量摘要：只返回有附加的节点（列表大小列与徽标共用）
  const sums = await sumAttachmentBytes('local', [mainId, bareNode.id])
  assert.equal(sums.size, 1)
  assert.deepEqual(sums.get(mainId), { count: 2, bytes: 12 })

  // 总量统计：全部内部卷合计与按卷过滤
  assert.equal(await getFilesAttachmentBytes(), 12)
  assert.equal(await getFilesAttachmentBytes(['local']), 12)
  assert.equal(await getFilesAttachmentBytes(['tmp', 'trash']), 0)
}

async function testSubtreeEnumerationAndEstimatesIncludeAttachments(): Promise<void> {
  await resetFiles()
  await filesMkdir('/user/箱')
  await filesCreateBinary('/user/箱/盘.img', new Uint8Array([1, 1, 1, 1]).buffer)
  const created = await filesCreateAttachment({
    mainFilePath: '/user/箱/盘.img',
    name: '缓存',
    bytes: new Uint8Array([5, 5, 5, 5, 5]).buffer,
  })
  // 对照组：同尺寸无附加的文件（估算差值 = 附加贡献）
  await filesMkdir('/user/对照')
  await filesCreateBinary('/user/对照/盘.img', new Uint8Array([1, 1, 1, 1]).buffer)

  // 子树枚举含附加：相对路径 主文件/.attach/附加名，绝对路径可解析；
  // 条目带 attachment 标记（打包/搜索类遍历据此过滤），普通文件为 false
  const entries = await listSubtreeFiles('/user/箱')
  const attachEntry = entries.find((entry) => entry.path === `盘.img/${FILES_ATTACH_SEGMENT}/${created.name}`)
  assert.ok(attachEntry, '子树枚举应包含附加条目')
  assert.equal(attachEntry.byteSize, 5)
  assert.equal(attachEntry.attachment, true)
  assert.equal(entries.find((entry) => entry.path === '盘.img')?.attachment, false)
  const attachStat = await filesStat(attachEntry.absolutePath)
  assert.equal(attachStat?.byteSize, 5)

  // 删除/复制工作量含附加（节点数 + 字节）
  const withAttach = await resolveFileNodeByAbsolutePath('/user/箱/盘.img')
  const withoutAttach = await resolveFileNodeByAbsolutePath('/user/对照/盘.img')
  assert.ok(withAttach && withoutAttach)
  const deleteWorkload = await estimateDeleteWorkload(withAttach.id)
  assert.equal(deleteWorkload.nodeCount, 2)
  assert.equal(deleteWorkload.byteSize, 4 + 5)
  const copyWorkload = await estimateCopyWorkload(withAttach.id, 'local')
  assert.equal(copyWorkload.nodeCount, 2)
  assert.equal(copyWorkload.byteSize, 4 + 5)

  // 配额预检口径：估算差值 = 附加（元数据 + 正文），附加复制不共享正文
  const withBytes = await estimateCopyBytes(withAttach.id, 'local')
  const withoutBytes = await estimateCopyBytes(withoutAttach.id, 'local')
  const attachNode = await resolveFileNodeByAbsolutePath(attachEntry.absolutePath)
  assert.ok(attachNode)
  assert.equal(withBytes - withoutBytes, estimateNodeMetaBytes(attachNode) + 5)
}

/**
 * 复制 v2 缓存附加：副本账本 byteSize 按段字节总和（与账本口径一致），
 * 不是整个 v2 文件的逻辑大小（镜像大偏移写会造出巨大的逻辑空洞）。
 */
async function testCopyVmDiskCacheAttachmentLedgerByteSize(): Promise<void> {
  await resetFiles()
  const mainPath = await seed()
  // 手工构造 v2：容量 1、单段 {offset: 1024, length: 4096}；
  // 文件逻辑大小 = 32 头 + 16 段表 + (1024 + 4096) 数据区 = 5168
  const segmentOffset = 1024
  const segmentLength = 4096
  const bytes = new Uint8Array(32 + 16 + segmentOffset + segmentLength)
  bytes.set(new TextEncoder().encode('VMDIFFC1'), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 1, true)
  view.setUint32(12, 1, true)
  view.setFloat64(32, segmentOffset, true)
  view.setFloat64(40, segmentLength, true)
  const created = await filesCreateAttachment({
    mainFilePath: mainPath,
    name: '虚拟机硬盘缓存',
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    tags: ['vm-disk-cache'],
    nameMode: 'exact',
  })

  await filesMkdir('/user/副本目录')
  const copied = await filesCopy(mainPath, '/user/副本目录')
  const copyAttachPath = `/user/副本目录/${copied.name}/${FILES_ATTACH_SEGMENT}/${created.name}`
  const copyStat = await filesStat(copyAttachPath)
  assert.ok(copyStat)
  assert.equal(
    copyStat.byteSize,
    segmentLength,
    '副本账本 byteSize 按段字节总和，而非文件逻辑大小 5168',
  )
  // 副本内容仍是完整 v2 文件（逻辑大小不变，只是账本口径不同）
  const copyBytes = new Uint8Array(await (await filesReadBlob(copyAttachPath)).arrayBuffer())
  assert.equal(copyBytes.byteLength, bytes.byteLength)
}

async function testRenameMoveDeleteCarryAttachments(): Promise<void> {
  await resetFiles()
  const mainPath = await seed()
  const attach =   await filesCreateAttachment({
    mainFilePath: mainPath,
    name: '缓存',
    bytes: new Uint8Array([5, 5]).buffer,
    tags: ['vm-disk-cache'],
  })
  await filesMkdir('/user/子目录')

  await claimDiskImagePath(mainPath, { kind: 'vm', id: 'vm-attach-del' })
  try {
    await assert.rejects(
      () => filesRemove(`${mainPath}/${FILES_ATTACH_SEGMENT}/缓存`),
      /无法删除.*虚拟机正在使用/,
    )
  } finally {
    releaseDiskImagePath(mainPath, { kind: 'vm', id: 'vm-attach-del' })
  }

  // 复制：附加跟着走（新主文件上有同标签附加，旧的不动）
  const copied = await filesCopy(mainPath, '/user/子目录')
  assert.equal(copied.kind, 'file')
  const copiedAttachments = await filesListAttachments(`/user/子目录/${copied.name}`, {
    tag: 'vm-disk-cache',
  })
  assert.equal(copiedAttachments.length, 1)
  assert.equal((await filesListAttachments(mainPath)).length, 1)

  // 删除主文件：附加随子树一起删（细节见 testDeleteReclaimsAttachmentBytesAndNodes）
  await filesRemove(mainPath)
  assert.equal(await filesStat(mainPath), undefined)
  assert.equal(await filesStat(`${mainPath}/${FILES_ATTACH_SEGMENT}/${attach.name}`), undefined)
}

async function testMountVolumesRejectAttachments(): Promise<void> {
  await resetFiles()
  // /mount/ 需要真实 FSA 句柄，这里只验证主文件不存在时的报错口径
  await assert.rejects(
    () =>
      filesCreateAttachment({
        mainFilePath: '/user/missing.img',
        name: '缓存',
        bytes: new Uint8Array([0]).buffer,
      }),
    /主文件不存在/,
  )
}

await testCreateListAndPathAccess()
await testAttachmentsHiddenFromDirectoryListing()
await testDeleteReclaimsAttachmentBytesAndNodes()
await testTrashCarriesAttachments()
await testRenameKeepsAttachmentsAccessible()
await testCrossVolumeMoveCarriesAttachments()
await testCrossVolumeMoveToNonAttachableVolumeRejected()
await testCopyAttachmentHasIndependentBody()
await testCopyVmDiskCacheAttachmentLedgerByteSize()
await testCopyOccupiedDiskImageRejected()
await testAttachmentByteSummaries()
await testSubtreeEnumerationAndEstimatesIncludeAttachments()
await testRenameMoveDeleteCarryAttachments()
await testMountVolumesRejectAttachments()
console.log('files-attachments.test.ts ok')
