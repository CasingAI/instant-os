/**
 * 磁盘镜像的线性分区图：按起始偏移把分区、MBR 与未分配空隙排成一段横条。
 */
import { layoutEqualPartitions, SECTOR_SIZE } from './disk-utility-format.ts'
import type { TreeNode } from './disk-utility-data.ts'

export type DiskMapTone = 'fat' | 'ntfs' | 'linux' | 'unknown' | 'free' | 'reserved'

export type DiskMapSegmentKind = 'reserved' | 'partition' | 'volume' | 'unallocated'

export type DiskMapSegment = {
  id: string
  kind: DiskMapSegmentKind
  startBytes: number
  sizeBytes: number
  label: string
  typeLabel: string
  tone: DiskMapTone
  nodeId?: string
}

const MBR_BYTES = 512

const FAT_TYPE_BYTES = new Set([
  0x01, 0x04, 0x06, 0x0b, 0x0c, 0x0e, 0x11, 0x14, 0x16, 0x1b, 0x1c,
])

export function toneForPartitionType(typeByte: number): DiskMapTone {
  if (FAT_TYPE_BYTES.has(typeByte)) return 'fat'
  if (typeByte === 0x07) return 'ntfs'
  if (typeByte === 0x83) return 'linux'
  return 'unknown'
}

function pushGap(
  segments: DiskMapSegment[],
  diskId: string,
  from: number,
  to: number,
  atStart: boolean,
): void {
  if (to <= from) return
  if (atStart && to - from >= MBR_BYTES) {
    segments.push({
      id: `${diskId}:mbr`,
      kind: 'reserved',
      startBytes: from,
      sizeBytes: MBR_BYTES,
      label: 'MBR',
      typeLabel: '主引导记录',
      tone: 'reserved',
    })
    from += MBR_BYTES
  }
  if (to <= from) return
  segments.push({
    id: `${diskId}:gap:${from}`,
    kind: 'unallocated',
    startBytes: from,
    sizeBytes: to - from,
    label: '未分配',
    typeLabel: '未分配',
    tone: 'free',
  })
}

export function buildDiskMap(node: TreeNode): DiskMapSegment[] | undefined {
  const diskBytes = node.imageFile?.sizeBytes
  if (!diskBytes || diskBytes <= 0) return undefined

  const partitions = (node.children ?? []).filter(
    (child) => child.kind === 'partition' && child.partition && child.partition.sizeBytes > 0,
  )

  if (partitions.length === 0) {
    if (node.fat) {
      return [
        {
          id: `${node.id}:volume`,
          kind: 'volume',
          startBytes: 0,
          sizeBytes: diskBytes,
          label: node.fat.label || node.label,
          typeLabel: node.fat.variant,
          tone: 'fat',
          nodeId: node.id,
        },
      ]
    }
    return [
      {
        id: `${node.id}:raw`,
        kind: 'unallocated',
        startBytes: 0,
        sizeBytes: diskBytes,
        label: '未初始化',
        typeLabel: 'RAW',
        tone: 'free',
      },
    ]
  }

  const sorted = [...partitions].sort(
    (a, b) => (a.partition?.startBytes ?? 0) - (b.partition?.startBytes ?? 0),
  )
  const segments: DiskMapSegment[] = []
  let cursor = 0

  for (const child of sorted) {
    const partition = child.partition
    if (!partition) continue
    pushGap(segments, node.id, cursor, partition.startBytes, cursor === 0)
    const fat = child.fat
    segments.push({
      id: child.id,
      kind: 'partition',
      startBytes: partition.startBytes,
      sizeBytes: partition.sizeBytes,
      label: fat?.label || child.label,
      typeLabel: fat?.variant ?? partition.typeLabel,
      tone: toneForPartitionType(partition.typeByte),
      nodeId: child.id,
    })
    cursor = Math.max(cursor, partition.startBytes + partition.sizeBytes)
  }

  pushGap(segments, node.id, cursor, diskBytes, false)
  return segments
}

export function buildPlannedDiskMap(params: {
  diskBytes: number
  count: number
  labels: string[]
  variantLabel: string
}): DiskMapSegment[] {
  const totalSectors = Math.floor(params.diskBytes / SECTOR_SIZE)
  const parts = layoutEqualPartitions(totalSectors, params.count)
  const diskId = 'planned'
  const segments: DiskMapSegment[] = []
  let cursor = 0

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!part) continue
    const startBytes = part.start * SECTOR_SIZE
    const sizeBytes = part.size * SECTOR_SIZE
    pushGap(segments, diskId, cursor, startBytes, cursor === 0)
    const name = params.labels[index]?.trim() || `分区 ${index + 1}`
    segments.push({
      id: `${diskId}:part${index + 1}`,
      kind: 'partition',
      startBytes,
      sizeBytes,
      label: name,
      typeLabel: params.variantLabel,
      tone: 'fat',
    })
    cursor = startBytes + sizeBytes
  }

  pushGap(segments, diskId, cursor, params.diskBytes, false)
  return segments
}

export function findAncestorImageRoot(root: TreeNode, id: string): TreeNode | undefined {
  if (root.kind === 'image-root') {
    if (root.id === id) return root
    if (root.children?.some((child) => child.id === id)) return root
  }
  if (!root.children) return undefined
  for (const child of root.children) {
    const found = findAncestorImageRoot(child, id)
    if (found) return found
  }
  return undefined
}
