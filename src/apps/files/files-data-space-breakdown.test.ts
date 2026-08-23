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

async function main(): Promise<void> {
  await testBreakdownIncludesTrashAndMatchesTotal()
  console.log('ok: breakdown includes trash and matches total')
  console.log('files-data-space-breakdown: all passed')
}

await main()
