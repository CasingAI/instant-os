/**
 * AI 愿望单：系统层 JSONL，固定路径 `/dev/terminal/wishlist.jsonl`。
 * 经 instant.wish 写入；guest fs 不可写（attributes.writable=false）。
 */
import { osNowMs } from '../../os/os-clock.ts'
import {
  joinFilesAbsolutePath,
  parseFilesAbsolutePath,
} from '../../apps/files/files-path.ts'
import {
  createFileWithBytes,
  estimateNodeMetaBytes,
  newFilesNodeId,
  readBlobBytes,
  writeBlobBytes,
} from '../../apps/files/files-storage.ts'
import type { FilesNode, FilesNodeAttributes } from '../../apps/files/files-types.ts'
import {
  emitSystemVfsChange,
  ensureDevSystemFolder,
} from '../../apps/files/files-system-vfs.ts'
import { resolveNodeByAbsolutePath } from '../../apps/files/files-vfs.ts'
import type { TerminalFsMode } from '../terminal-fs-mode.ts'
import { TERMINAL_DEV_ROOT, ensureTerminalChangesetRoots } from '../terminal-changeset-store.ts'
import type {
  InstantShellWishCategory,
  InstantShellWishOptions,
} from './instant-shell-types.ts'

export const WISHLIST_PATH = joinFilesAbsolutePath(TERMINAL_DEV_ROOT, 'wishlist.jsonl')

const SYSTEM_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: false }

export const WISH_SUMMARY_MAX = 160
export const WISH_BLOCKED_STEP_MAX = 240
export const WISH_DETAIL_MAX = 500
export const WISH_ATTEMPTED_MAX_ITEMS = 5
export const WISH_ATTEMPTED_ITEM_MAX = 160
export const WISHLIST_MAX_LINES = 500
export const WISHLIST_MAX_BYTES = 256 * 1024

const WISH_CATEGORIES: ReadonlySet<string> = new Set([
  'capability',
  'policy',
  'network',
  'data',
  'tooling',
  'other',
])

export type WishlistRecord = {
  id: string
  createdAt: number
  summary: string
  category: InstantShellWishCategory
  blockedStep: string
  attempted?: string[]
  detail?: string
  cwd: string
  fsMode: TerminalFsMode
  terminalSessionId: string
}

export type NormalizedWishInput = {
  summary: string
  category: InstantShellWishCategory
  blockedStep: string
  attempted?: string[]
  detail?: string
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max)
}

/** 去重键：折叠空白并小写。 */
export function normalizeWishSummaryKey(summary: string): string {
  return summary.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function isWishCategory(value: unknown): value is InstantShellWishCategory {
  return typeof value === 'string' && WISH_CATEGORIES.has(value)
}

/**
 * 校验并截断客侧 wish 选项。非法则抛错。
 */
export function normalizeWishOptions(options: InstantShellWishOptions): NormalizedWishInput {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('wish 选项必须是对象')
  }
  if (typeof options.summary !== 'string') {
    throw new Error('summary 必须是字符串')
  }
  const summary = truncate(options.summary.trim(), WISH_SUMMARY_MAX)
  if (!summary) {
    throw new Error('summary 不能为空')
  }
  if (!isWishCategory(options.category)) {
    throw new Error(
      'category 必须是 capability | policy | network | data | tooling | other',
    )
  }
  if (typeof options.blockedStep !== 'string') {
    throw new Error('blockedStep 必须是字符串')
  }
  const blockedStep = truncate(options.blockedStep.trim(), WISH_BLOCKED_STEP_MAX)
  if (!blockedStep) {
    throw new Error('blockedStep 不能为空')
  }

  let attempted: string[] | undefined
  if (options.attempted !== undefined) {
    if (!Array.isArray(options.attempted)) {
      throw new Error('attempted 必须是字符串数组')
    }
    const items: string[] = []
    for (const item of options.attempted) {
      if (typeof item !== 'string') {
        throw new Error('attempted 必须是字符串数组')
      }
      const trimmed = truncate(item.trim(), WISH_ATTEMPTED_ITEM_MAX)
      if (trimmed) items.push(trimmed)
      if (items.length >= WISH_ATTEMPTED_MAX_ITEMS) break
    }
    if (items.length > 0) attempted = items
  }

  let detail: string | undefined
  if (options.detail !== undefined) {
    if (typeof options.detail !== 'string') {
      throw new Error('detail 必须是字符串')
    }
    const trimmed = truncate(options.detail.trim(), WISH_DETAIL_MAX)
    if (trimmed) detail = trimmed
  }

  return { summary, category: options.category, blockedStep, attempted, detail }
}

function encodeTextBytes(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function decodeText(bytes: ArrayBuffer): string {
  return new TextDecoder().decode(bytes)
}

function parseJsonlRecords(text: string): WishlistRecord[] {
  const records: WishlistRecord[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as WishlistRecord
      if (
        parsed &&
        typeof parsed.id === 'string' &&
        typeof parsed.summary === 'string' &&
        typeof parsed.category === 'string' &&
        typeof parsed.terminalSessionId === 'string'
      ) {
        records.push(parsed)
      }
    } catch {
      // 跳过损坏行
    }
  }
  return records
}

function recordsToJsonl(records: WishlistRecord[]): string {
  if (records.length === 0) return ''
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`
}

/** 保留最近若干行，并尽量不超过字节上限。 */
export function trimWishlistRecords(records: WishlistRecord[]): WishlistRecord[] {
  let kept = records.length > WISHLIST_MAX_LINES ? records.slice(-WISHLIST_MAX_LINES) : records
  let text = recordsToJsonl(kept)
  while (kept.length > 1 && text.length > WISHLIST_MAX_BYTES) {
    kept = kept.slice(1)
    text = recordsToJsonl(kept)
  }
  if (kept.length === 1 && text.length > WISHLIST_MAX_BYTES) {
    // 单行仍过大：截断 detail / attempted 后仍过大则原样写（容量层另有 assert）
    return kept
  }
  return kept
}

async function readWishlistRecords(): Promise<WishlistRecord[]> {
  const node = await resolveNodeByAbsolutePath(WISHLIST_PATH)
  if (!node || node.kind !== 'file') return []
  const bytes = await readBlobBytes(node.id)
  if (!bytes) return []
  return parseJsonlRecords(decodeText(bytes))
}

async function writeWishlistRecords(records: WishlistRecord[]): Promise<void> {
  await ensureTerminalChangesetRoots()
  const trimmed = trimWishlistRecords(records)
  const text = recordsToJsonl(trimmed)
  const bytes = encodeTextBytes(text)
  const existing = await resolveNodeByAbsolutePath(WISHLIST_PATH)
  if (existing?.kind === 'file') {
    await writeBlobBytes({
      id: existing.id,
      bytes,
      previousByteSize: existing.byteSize,
      nameMetaDelta: 0,
    })
    emitSystemVfsChange(WISHLIST_PATH, 'modified')
    return
  }

  const parsed = parseFilesAbsolutePath(WISHLIST_PATH)
  if (!parsed) throw new Error(`无效的 wishlist 路径：${WISHLIST_PATH}`)
  const name = parsed.segments[parsed.segments.length - 1]
  if (!name) throw new Error(`无效的 wishlist 路径：${WISHLIST_PATH}`)
  const parent = await ensureDevSystemFolder(TERMINAL_DEV_ROOT)
  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: 'dev',
    parentId: parent.id,
    name,
    kind: 'file',
    mimeType: 'application/x-ndjson',
    byteSize: bytes.byteLength,
    createdAt: now,
    updatedAt: now,
    attributes: SYSTEM_ATTRIBUTES,
  }
  await createFileWithBytes({
    node,
    bytes,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: 'exact',
  })
  emitSystemVfsChange(WISHLIST_PATH, 'created')
}

/** 同会话 + category + 规范化 summary 去重。 */
export async function findDuplicateWish(params: {
  terminalSessionId: string
  category: InstantShellWishCategory
  summary: string
}): Promise<WishlistRecord | undefined> {
  const key = normalizeWishSummaryKey(params.summary)
  const records = await readWishlistRecords()
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i]
    if (!record) continue
    if (record.terminalSessionId !== params.terminalSessionId) continue
    if (record.category !== params.category) continue
    if (normalizeWishSummaryKey(record.summary) === key) return record
  }
  return undefined
}

export async function appendWish(record: WishlistRecord): Promise<void> {
  const records = await readWishlistRecords()
  records.push(record)
  await writeWishlistRecords(records)
}
