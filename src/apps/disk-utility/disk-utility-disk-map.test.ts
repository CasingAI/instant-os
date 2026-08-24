/**
 * 分区横条：按偏移拼分区 / MBR / 未分配。
 * 运行：node --experimental-strip-types src/apps/disk-utility/disk-utility-disk-map.test.ts
 */
import assert from 'node:assert/strict'
import { buildDiskMap, buildPlannedDiskMap, type DiskMapSegment } from './disk-utility-disk-map.ts'
import type { TreeNode } from './disk-utility-data.ts'

const DISK = 64 * 1024 * 1024

function kinds(segments: DiskMapSegment[] | undefined): string[] {
  return (segments ?? []).map((segment) => `${segment.kind}:${segment.label}`)
}

function imageRoot(partial: Partial<TreeNode> & Pick<TreeNode, 'id'>): TreeNode {
  return {
    kind: 'image-root',
    label: 'blank',
    imageFile: { path: '/user/Disks/blank.img', sizeBytes: DISK },
    ...partial,
  }
}

{
  const segments = buildDiskMap(
    imageRoot({
      id: 'image:blank',
      fat: { variant: 'FAT16', label: 'BLANK', clusterSizeBytes: 2048, totalClusters: 100 },
    }),
  )
  assert.deepEqual(kinds(segments), ['volume:BLANK'])
  assert.equal(segments?.[0]?.sizeBytes, DISK)
  assert.equal(segments?.[0]?.nodeId, 'image:blank')
}

{
  const start = 2048 * 512
  const size = 60 * 1024 * 1024
  const segments = buildDiskMap(
    imageRoot({
      id: 'image:blank',
      children: [
        {
          id: 'image:blank:part1',
          kind: 'partition',
          label: '分区 1',
          partition: {
            index: 1,
            startBytes: start,
            sizeBytes: size,
            typeByte: 0x0e,
            typeLabel: 'FAT16 LBA',
            active: true,
          },
          fat: { variant: 'FAT16', label: 'BLANK', clusterSizeBytes: 2048, totalClusters: 100 },
        },
      ],
    }),
  )
  assert.ok(segments)
  assert.equal(segments[0]?.kind, 'reserved')
  assert.equal(segments[0]?.sizeBytes, 512)
  assert.equal(segments[1]?.kind, 'unallocated')
  assert.equal(segments[1]?.startBytes, 512)
  assert.equal(segments[1]?.sizeBytes, start - 512)
  assert.equal(segments[2]?.kind, 'partition')
  assert.equal(segments[2]?.label, 'BLANK')
  assert.equal(segments[2]?.typeLabel, 'FAT16')
  assert.equal(segments[2]?.tone, 'fat')
  const tail = segments[3]
  assert.equal(tail?.kind, 'unallocated')
  assert.equal(tail?.startBytes, start + size)
  assert.equal(tail?.sizeBytes, DISK - start - size)
}

{
  const segments = buildDiskMap(
    imageRoot({
      id: 'image:raw',
    }),
  )
  assert.deepEqual(kinds(segments), ['unallocated:未初始化'])
}

{
  const planned = buildPlannedDiskMap({
    diskBytes: DISK,
    count: 2,
    labels: ['ONE', 'TWO'],
    variantLabel: 'FAT16',
  })
  const parts = planned.filter((segment) => segment.kind === 'partition')
  assert.equal(parts.length, 2)
  assert.equal(parts[0]?.label, 'ONE')
  assert.equal(parts[1]?.label, 'TWO')
  assert.ok(planned.some((segment) => segment.kind === 'reserved'))
  const total = planned.reduce((sum, segment) => sum + segment.sizeBytes, 0)
  assert.equal(total, DISK)
}

console.log('disk-utility-disk-map.test.ts ok')
