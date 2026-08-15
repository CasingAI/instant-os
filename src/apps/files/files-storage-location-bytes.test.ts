/**
 * getFilesBytesByLocation 多卷字节统计单测。
 * 运行：node --experimental-strip-types src/apps/files/files-storage-location-bytes.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { defaultFilesNodeAttributes } from './files-types.ts'
import {
  createFileWithBlob,
  estimateNodeMetaBytes,
  FILE_SIDEBAR_METRIC_LOCATIONS,
  getFilesBytesByLocation,
  newFilesNodeId,
  resetFilesDbForTests,
} from './files-storage.ts'
import { osNowMs } from '../../os/os-clock.ts'
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

{
  await resetFilesDbForTests()
  const localPayload = 'local-data'
  const devPayload = 'dev-data-longer'
  const tmpPayload = 'tmp'
  const trashPayload = 'trash-data'

  await createFileWithBlob({
    node: makeFileNode('local', 'local.txt'),
    text: localPayload,
    metaBytes: estimateNodeMetaBytes(makeFileNode('local', 'local.txt')),
    nameMode: 'exact',
  })
  await createFileWithBlob({
    node: makeFileNode('dev', 'dev.txt'),
    text: devPayload,
    metaBytes: estimateNodeMetaBytes(makeFileNode('dev', 'dev.txt')),
    nameMode: 'exact',
  })
  await createFileWithBlob({
    node: makeFileNode('tmp', 'tmp.txt'),
    text: tmpPayload,
    metaBytes: estimateNodeMetaBytes(makeFileNode('tmp', 'tmp.txt')),
    nameMode: 'exact',
  })
  await createFileWithBlob({
    node: makeFileNode('trash', 'trash.txt'),
    text: trashPayload,
    metaBytes: estimateNodeMetaBytes(makeFileNode('trash', 'trash.txt')),
    nameMode: 'exact',
  })

  const byLocation = await getFilesBytesByLocation(FILE_SIDEBAR_METRIC_LOCATIONS)
  const map = new Map(byLocation.map((entry) => [entry.locationId, entry.bytes]))
  // 文件 byteSize 为纯正文字节；各卷互不污染
  assert.equal(map.get('local'), new TextEncoder().encode(localPayload).length)
  assert.equal(map.get('dev'), new TextEncoder().encode(devPayload).length)
  assert.equal(map.get('tmp'), new TextEncoder().encode(tmpPayload).length)
  assert.equal(map.get('trash'), new TextEncoder().encode(trashPayload).length)
  console.log('ok: sidebar metric locations report per-volume bytes')
}

{
  await resetFilesDbForTests()
  // 只查指定卷：未出现在列表中的卷不应被统计
  await createFileWithBlob({
    node: makeFileNode('local', 'a.txt'),
    text: 'only-local',
    metaBytes: estimateNodeMetaBytes(makeFileNode('local', 'a.txt')),
    nameMode: 'exact',
  })
  await createFileWithBlob({
    node: makeFileNode('trash', 'b.txt'),
    text: 'only-trash',
    metaBytes: estimateNodeMetaBytes(makeFileNode('trash', 'b.txt')),
    nameMode: 'exact',
  })
  const partial = await getFilesBytesByLocation(['local', 'trash'])
  assert.deepEqual(
    new Set(partial.map((entry) => entry.locationId)),
    new Set(['local', 'trash']),
  )
  const localEntry = partial.find((entry) => entry.locationId === 'local')
  const trashEntry = partial.find((entry) => entry.locationId === 'trash')
  assert.equal(localEntry?.bytes, new TextEncoder().encode('only-local').length)
  assert.equal(trashEntry?.bytes, new TextEncoder().encode('only-trash').length)
  console.log('ok: custom location filter returns only requested volumes')
}

console.log('files-storage-location-bytes: all passed')
