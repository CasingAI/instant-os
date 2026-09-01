/**
 * 磁盘镜像 FAT 修复：先跑一次带收集的扫描拿到簇级结构化数据，
 * 在内存 FAT 副本上按「目录项 → 交叉链接 → 链结构 → 大小对齐 → 孤儿回收 → 副本同步」
 * 顺序模拟全部修复，再一次性产出字节补丁；确认后按偏移写回镜像并复扫验证。
 * 引导区/几何等结构性错误不可信，整卷拒绝修复（skipped）。
 */
import { filesWriteBytesRange } from '../files/files-api.ts'
import { normalizeDiskImagePath } from '../files/files-disk-image-occupancy.ts'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import type { DiskPartitionInfo } from './disk-utility-data.ts'
import {
  fatEntryFromBytes,
  isBad,
  isEoc,
  runDiskImageScan,
  type DiskScanItemId,
  type DiskScanItemState,
  type DiskScanIssue,
  type DiskScanOptions,
  type DiskScanReport,
  type FatEntryRecord,
  type FatGeometry,
  type FatScanCollection,
} from './disk-utility-scan.ts'

const WRITE_CHUNK = 1024 * 1024

/** 结构性问题：几何/引导区不可信时修复会误伤数据，含其中任意一项就整卷拒绝修复。 */
const BLOCKING_ISSUE_CODES = new Set([
  'invalid-boot',
  'geometry-out-of-range',
  'fat-too-small',
  'invalid-root-cluster',
  'no-data-clusters',
  'exfat-unsupported',
  'directory-depth-limit',
  'directory-entry-limit',
  'scan-failed',
])

export type DiskRepairWrite = {
  offset: number
  data: Uint8Array
  label: string
}

export type DiskRepairAction = {
  kind: 'dir-entry' | 'cross-link' | 'chain' | 'size' | 'orphan' | 'fat-sync'
  summary: string
}

export type DiskRepairPlan = {
  path: string
  target: string
  partition?: DiskPartitionInfo
  actions: DiskRepairAction[]
  skipped: DiskScanIssue[]
  writes: DiskRepairWrite[]
}

export type DiskRepairResult = {
  path: string
  target: string
  applied: DiskRepairAction[]
  after: DiskScanReport
}

type RepairDraft = {
  geometry: FatGeometry
  /** 第 1 份 FAT 的工作副本，所有 FAT 变更先落在这里用于模拟 */
  fat: Uint8Array
  fatMutations: Map<number, number>
  writes: DiskRepairWrite[]
  actions: DiskRepairAction[]
}

type RepairRecord = FatEntryRecord

function eocValue(geometry: FatGeometry): number {
  if (geometry.variant === 'FAT12') return 0xfff
  if (geometry.variant === 'FAT16') return 0xffff
  return 0x0fffffff
}

function isValidCluster(geometry: FatGeometry, cluster: number): boolean {
  return cluster >= 2 && cluster <= geometry.totalClusters + 1
}

function writeFatEntry(geometry: FatGeometry, fat: Uint8Array, cluster: number, value: number): void {
  if (geometry.variant === 'FAT12') {
    const offset = Math.floor((cluster * 3) / 2)
    if ((cluster & 1) === 0) {
      fat[offset] = value & 0xff
      fat[offset + 1] = (fat[offset + 1]! & 0xf0) | ((value >>> 8) & 0x0f)
    } else {
      fat[offset] = (fat[offset]! & 0x0f) | ((value & 0x0f) << 4)
      fat[offset + 1] = (value >>> 4) & 0xff
    }
    return
  }
  if (geometry.variant === 'FAT16') {
    const offset = cluster * 2
    fat[offset] = value & 0xff
    fat[offset + 1] = (value >>> 8) & 0xff
    return
  }
  const offset = cluster * 4
  fat[offset] = value & 0xff
  fat[offset + 1] = (value >>> 8) & 0xff
  fat[offset + 2] = (value >>> 16) & 0xff
  // FAT32 只用低 28 位，保留高 4 位
  fat[offset + 3] = (fat[offset + 3]! & 0xf0) | ((value >>> 24) & 0x0f)
}

function setFatCluster(draft: RepairDraft, cluster: number, value: number): void {
  if (fatEntryFromBytes(draft.geometry, draft.fat, cluster) === value) return
  writeFatEntry(draft.geometry, draft.fat, cluster, value)
  draft.fatMutations.set(cluster, value)
}

function patchEntryBytes(draft: RepairDraft, record: RepairRecord, fieldOffset: number, value: number, length: 2 | 4): void {
  if (record.entryOffset === undefined) return
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) bytes[i] = (value >>> (8 * i)) & 0xff
  draft.writes.push({ offset: record.entryOffset + fieldOffset, data: bytes, label: record.path })
}

function patchEntryStart(draft: RepairDraft, record: RepairRecord, start: number): void {
  if (draft.geometry.variant === 'FAT32') {
    patchEntryBytes(draft, record, 26, start & 0xffff, 2)
    patchEntryBytes(draft, record, 20, (start >>> 16) & 0xffff, 2)
  } else {
    patchEntryBytes(draft, record, 26, start & 0xffff, 2)
  }
}

function patchEntrySize(draft: RepairDraft, record: RepairRecord, size: number): void {
  patchEntryBytes(draft, record, 28, size >>> 0, 4)
}

/**
 * 按扫描同规则重走一条簇链；mutate 时把异常终止处补上 EOC。
 * 返回修复后的链与是否发生过 FAT 变更。
 */
function repairWalkChain(
  draft: RepairDraft,
  firstCluster: number,
  mutate: boolean,
): { chain: number[]; fixed: boolean } {
  const { geometry, fat } = draft
  const maxCluster = geometry.totalClusters + 1
  if (firstCluster < 2 || firstCluster > maxCluster) return { chain: [], fixed: false }
  const mutationsBefore = draft.fatMutations.size
  const chain: number[] = []
  const seen = new Set<number>()
  let cluster = firstCluster
  for (;;) {
    if (seen.has(cluster)) {
      // 成环：最后一簇补 EOC 断开
      if (mutate && chain.length > 0) setFatCluster(draft, chain[chain.length - 1]!, eocValue(geometry))
      break
    }
    seen.add(cluster)
    chain.push(cluster)
    if (chain.length > geometry.totalClusters) {
      if (mutate && chain.length > 0) setFatCluster(draft, chain[chain.length - 1]!, eocValue(geometry))
      chain.pop()
      break
    }
    const next = fatEntryFromBytes(geometry, fat, cluster)
    if (isEoc(geometry, next)) break
    if (next === 0 || next === 1 || isBad(geometry, next) || next > maxCluster) {
      // 提前指向空闲簇 / 无效链接：补 EOC 终止
      if (mutate) setFatCluster(draft, cluster, eocValue(geometry))
      break
    }
    cluster = next
  }
  return { chain, fixed: draft.fatMutations.size !== mutationsBefore }
}

function buildRepairPlan(
  collection: FatScanCollection,
  issues: DiskScanIssue[],
  path: string,
  target: string,
  partition?: DiskPartitionInfo,
): DiskRepairPlan {
  const emptyPlan: DiskRepairPlan = { path, target, partition, actions: [], skipped: issues, writes: [] }
  if (issues.some((issue) => BLOCKING_ISSUE_CODES.has(issue.code))) return emptyPlan

  const geometry = collection.geometry
  const clusterBytes = geometry.clusterBytes
  const eoc = eocValue(geometry)
  const draft: RepairDraft = {
    geometry,
    fat: new Uint8Array(collection.fat),
    fatMutations: new Map(),
    writes: [],
    actions: [],
  }
  const records: RepairRecord[] = collection.entries.map((entry) => ({ ...entry, chain: [...entry.chain] }))
  const recordByPath = new Map<string, RepairRecord>()
  for (const record of records) {
    if (!recordByPath.has(record.path)) recordByPath.set(record.path, record)
  }

  // 1. 目录项级修复：无效起始簇 / 有大小无数据 → 重置为空文件（保留名字，不删目录项）
  for (const record of records) {
    if (record.entryOffset === undefined) continue
    if (record.firstCluster !== 0 && !isValidCluster(geometry, record.firstCluster)) {
      patchEntryStart(draft, record, 0)
      patchEntrySize(draft, record, 0)
      record.firstCluster = 0
      record.size = 0
      record.chain = []
      draft.actions.push({ kind: 'dir-entry', summary: `「${record.path}」起始簇无效，已重置为空文件` })
      continue
    }
    if (record.firstCluster === 0 && record.size > 0) {
      patchEntrySize(draft, record, 0)
      record.size = 0
      draft.actions.push({ kind: 'dir-entry', summary: `「${record.path}」有大小但没有数据，已重置为空文件` })
    }
  }

  // 2. 交叉链接：同一簇保留目录树遍历顺序的第一个引用者，截断其余
  for (const [cluster, refs] of collection.references) {
    if (refs.length < 2) continue
    const keeper = recordByPath.get(refs[0]!)
    for (const loserPath of refs.slice(1)) {
      const loser = recordByPath.get(loserPath)
      if (!loser || loser === keeper) continue
      const pos = loser.chain.indexOf(cluster)
      if (pos === -1) continue
      if (pos === 0) {
        if (loser.entryOffset !== undefined) {
          patchEntryStart(draft, loser, 0)
          patchEntrySize(draft, loser, 0)
        }
        loser.firstCluster = 0
        loser.size = 0
        loser.chain = []
      } else {
        setFatCluster(draft, loser.chain[pos - 1]!, eoc)
        const kept = loser.chain.slice(0, pos)
        loser.chain = kept
        if (!loser.directory && loser.size > kept.length * clusterBytes) {
          patchEntrySize(draft, loser, kept.length * clusterBytes)
          loser.size = kept.length * clusterBytes
        }
      }
      draft.actions.push({
        kind: 'cross-link',
        summary: `簇 ${cluster} 被「${keeper?.path ?? '?'}」与「${loser.path}」同时引用，已截断「${loser.path}」`,
      })
    }
  }

  // 3. 簇链结构修复：成环 / 提前指向空闲簇 / 无效链接 / 超长 → 补 EOC 截断
  for (const record of records) {
    if (record.firstCluster < 2) continue
    const lengthBefore = record.chain.length
    const { chain, fixed } = repairWalkChain(draft, record.firstCluster, true)
    if (!fixed) continue
    const label = record.path || '(根目录)'
    record.chain = chain
    if (record.directory && chain.length < lengthBefore) {
      // 目录链被截断，其内部更深层条目可能已丢失；孤儿回收对其保持保守，残留交由下一次修复收敛
      draft.actions.push({ kind: 'chain', summary: `目录「${label}」簇链异常，已截断到 ${chain.length} 簇` })
    } else {
      if (!record.directory && record.size > chain.length * clusterBytes) {
        patchEntrySize(draft, record, chain.length * clusterBytes)
        record.size = chain.length * clusterBytes
      }
      draft.actions.push({ kind: 'chain', summary: `「${label}」簇链异常，已补终止标记（${chain.length} 簇）` })
    }
  }

  // 4. 文件大小与簇链对齐：多出的簇显式释放（此时每簇至多属于一条链，释放安全）
  for (const record of records) {
    if (record.directory || record.entryOffset === undefined) continue
    const capacity = record.chain.length * clusterBytes
    if (record.size > capacity) {
      patchEntrySize(draft, record, capacity)
      record.size = capacity
      draft.actions.push({ kind: 'size', summary: `「${record.path}」大小超出簇链容量，已收缩到 ${formatStorageSize(capacity)}` })
      continue
    }
    if (record.size < capacity) {
      const needed = Math.ceil(record.size / clusterBytes)
      if (needed < record.chain.length) {
        const released = record.chain.length - needed
        if (needed === 0) {
          for (const cluster of record.chain) setFatCluster(draft, cluster, 0)
          patchEntryStart(draft, record, 0)
          record.firstCluster = 0
          record.chain = []
        } else {
          setFatCluster(draft, record.chain[needed - 1]!, eoc)
          for (const cluster of record.chain.slice(needed)) setFatCluster(draft, cluster, 0)
          record.chain = record.chain.slice(0, needed)
        }
        draft.actions.push({ kind: 'size', summary: `「${record.path}」簇链超出文件大小，已释放 ${released} 个多余簇` })
      }
      // needed === chain.length：大小已与修复后的链对齐，无需变更
    }
  }

  // 5. 孤儿回收：基于修复后的 FAT 重算可达集，已分配且不可达的簇清 0
  const reachableNow = new Set<number>()
  for (const record of records) {
    if (record.firstCluster < 2) continue
    const { chain } = repairWalkChain(draft, record.firstCluster, false)
    for (const cluster of chain) reachableNow.add(cluster)
  }
  const orphans: number[] = []
  for (let cluster = 2; cluster <= geometry.totalClusters + 1; cluster += 1) {
    const value = fatEntryFromBytes(geometry, draft.fat, cluster)
    if (value !== 0 && !reachableNow.has(cluster)) orphans.push(cluster)
  }
  if (orphans.length > 0) {
    for (const cluster of orphans) setFatCluster(draft, cluster, 0)
    draft.actions.push({
      kind: 'orphan',
      summary: `回收 ${orphans.length} 个孤儿簇（约 ${formatStorageSize(orphans.length * clusterBytes)}）`,
    })
  }

  // 6. FAT 副本同步：把修复后的第 1 份写回全部副本槽位
  if (draft.fatMutations.size > 0 || issues.some((issue) => issue.code === 'fat-copies-differ')) {
    for (let copy = 0; copy < geometry.fatCount; copy += 1) {
      const offset = geometry.base + (geometry.reservedSectors + copy * geometry.fatSizeSectors) * geometry.bytesPerSector
      draft.writes.push({
        offset,
        data: draft.fat,
        label: geometry.fatCount > 1 ? `FAT 副本 ${copy + 1}/${geometry.fatCount}` : 'FAT 表',
      })
    }
    draft.actions.push({
      kind: 'fat-sync',
      summary: geometry.fatCount > 1 ? `写回并同步全部 ${geometry.fatCount} 份 FAT 副本` : '写回 FAT 表',
    })
  }

  return { path, target, partition, actions: draft.actions, skipped: [], writes: draft.writes }
}

/**
 * 只读阶段：重新扫描并构建修复计划。status 非 issues 或问题全部不可修复时
 * plan.actions 为空（skipped 说明原因）。
 */
export async function planDiskImageRepair(
  options: DiskScanOptions,
): Promise<{ report: DiskScanReport; plan: DiskRepairPlan | undefined }> {
  let collection: FatScanCollection | undefined
  const report = await runDiskImageScan({
    ...options,
    collect: (found) => {
      collection = found
    },
  })
  if (report.status !== 'issues' || !collection) return { report, plan: undefined }
  const plan = buildRepairPlan(collection, report.issues, report.path, report.target, options.partition)
  return { report, plan }
}

async function writeRange(path: string, offset: number, data: Uint8Array): Promise<void> {
  let cursor = 0
  while (cursor < data.byteLength) {
    const take = Math.min(WRITE_CHUNK, data.byteLength - cursor)
    await filesWriteBytesRange(path, offset + cursor, data.subarray(cursor, cursor + take))
    cursor += take
  }
}

/** 写入阶段：在 withExclusiveImageAccess 内调用。补丁写完后复扫验证。 */
export async function applyDiskImageRepair(options: {
  plan: DiskRepairPlan
  signal?: AbortSignal
  onItemUpdate?: (id: DiskScanItemId, state: DiskScanItemState) => void
}): Promise<DiskRepairResult> {
  const plan = options.plan
  const path = normalizeDiskImagePath(plan.path)
  for (const write of plan.writes) {
    await writeRange(path, write.offset, write.data)
  }
  const after = await runDiskImageScan({
    path,
    partition: plan.partition,
    signal: options.signal,
    onItemUpdate: options.onItemUpdate,
  })
  return { path, target: after.target, applied: plan.actions, after }
}
