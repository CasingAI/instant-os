/**
 * 数据空间「文件」明细与设置页总额对齐。
 * 运行：node --experimental-strip-types src/apps/files/files-data-space-breakdown.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { osNowMs } from '../../os/os-clock.ts'
import { loadDataSpaceFilesBreakdown } from './files-data-space-breakdown.ts'
import { defaultFilesNodeAttributes } from './files-types.ts'
import {
  createFileWithBlob,
  estimateNodeMetaBytes,
  getFilesTotalBytes,
  newFilesNodeId,
  resetFilesDbForTests,
} from './files-storage.ts'
import type { FilesLocationId, FilesNode } from './files-types.ts'

function makeFileNode(locationId: FilesLocationId, name: string): FilesNode {
  const now = osNowMs()
  return {
    id: newFilesNodeId(),
    locationId,
    parentId: undefined,
    name,
    kind: 'file',
    mimeType: 'text/plain',
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes(locationId),
  }
}

async function testBreakdownIncludesTrashAndMatchesTotal(): Promise<void> {
  await resetFilesDbForTests()
  await createFileWithBlob({
    node: makeFileNode('local', 'user.bin'),
    text: 'user-data',
    metaBytes: estimateNodeMetaBytes(makeFileNode('local', 'user.bin')),
    nameMode: 'exact',
  })
  const trashPayload = 'trash-data-longer'
  await createFileWithBlob({
    node: makeFileNode('trash', 'deleted.bin'),
    text: trashPayload,
    metaBytes: estimateNodeMetaBytes(makeFileNode('trash', 'deleted.bin')),
    nameMode: 'exact',
  })

  const breakdown = await loadDataSpaceFilesBreakdown()
  const filesTotal = await getFilesTotalBytes()

  assert.equal(breakdown.totalBytes, filesTotal)
  assert.equal(breakdown.appDataBytes, 0)
  assert.equal(
    breakdown.rows.find((row) => row.id === 'trash')?.bytes,
    new TextEncoder().encode(trashPayload).length,
  )
  assert.equal(
    breakdown.rows.reduce((sum, row) => sum + row.bytes, 0),
    breakdown.totalBytes,
  )
}

/**
 * 附加说明行：字节已计入各卷行，单列展示但不重复计量（不进 attributedBytes / 未归类）。
 */
async function testBreakdownAttachmentsRow(): Promise<void> {
  await resetFilesDbForTests()
  const main = makeFileNode('local', '盘.img')
  await createFileWithBlob({
    node: main,
    text: 'disk',
    metaBytes: estimateNodeMetaBytes(main),
    nameMode: 'exact',
  })
  const attachPayload = 'cache-bytes'
  const attachBytes = new TextEncoder().encode(attachPayload).length
  await createFileWithBlob({
    node: {
      ...makeFileNode('local', '缓存'),
      parentId: main.id,
      attachment: true,
      attachmentTags: ['vm-disk-cache'],
    },
    text: attachPayload,
    metaBytes: estimateNodeMetaBytes(makeFileNode('local', '缓存')),
    nameMode: 'exact',
  })

  const breakdown = await loadDataSpaceFilesBreakdown()

  // 附加行 = 附加总字节；local 卷行含主文件 + 附加（getFilesBytesByLocation 同源）
  const attachRow = breakdown.rows.find((row) => row.id === 'attachments')
  assert.ok(attachRow, '存在附加字节时应出现 attachments 说明行')
  assert.equal(attachRow.bytes, attachBytes)
  assert.equal(
    breakdown.rows.find((row) => row.id === 'local')?.bytes,
    new TextEncoder().encode('disk').length + attachBytes,
  )

  // 说明行不重复计量：attributedBytes 只含各卷行，未归类仍对齐差额
  const volumeRowsSum = breakdown.rows
    .filter((row) => row.id !== 'attachments')
    .reduce((sum, row) => sum + row.bytes, 0)
  assert.equal(breakdown.attributedBytes + (breakdown.rows.find((r) => r.id === 'unattributed')?.bytes ?? 0), volumeRowsSum)
}

async function main(): Promise<void> {
  await testBreakdownIncludesTrashAndMatchesTotal()
  console.log('ok: breakdown includes trash and matches total')
  await testBreakdownAttachmentsRow()
  console.log('ok: breakdown attachments row informational only')
  console.log('files-data-space-breakdown: all passed')
}

await main()
