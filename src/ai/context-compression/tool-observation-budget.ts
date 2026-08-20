import type { AgentCompressionSpill } from './types.ts'

export const MAX_INLINE_TOOL_CHARS = 16_000
export const HEAD_TAIL_EACH = 6_000
export const SPILL_PREVIEW_EACH = 2_000
const ERROR_CONTEXT_LINES = 40

const ERROR_MARKERS = [
  'Error:',
  'ERROR',
  'FAILED',
  'Traceback',
  'error TS',
  'Exception',
  'panic:',
] as const

export type ToolBudgetDedupState = {
  /** hash → first step */
  seen: Map<string, number>
}

export function createToolBudgetDedupState(): ToolBudgetDedupState {
  return { seen: new Map() }
}

/** 轻量同步内容指纹（FNV-1a 混入长度 → 12 hex） */
export function hashToolContent(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  let hash2 = 0x811c9dc5 ^ text.length
  for (let i = text.length - 1; i >= 0; i -= 1) {
    hash2 ^= text.charCodeAt(i)
    hash2 = Math.imul(hash2, 0x01000193)
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}${(hash2 >>> 0).toString(16).padStart(8, '0')}`.slice(0, 12)
}

export type ApplyToolObservationBudgetResult = {
  content: string
  changed: boolean
  spilled: boolean
  duplicate: boolean
}

/**
 * L0：工具结果注入前的观测预算。
 * 已含 spill 标记的短柄不再二次裁剪。
 */
export async function applyToolObservationBudget(
  raw: string,
  options: {
    step: number
    dedup: ToolBudgetDedupState
    spill?: AgentCompressionSpill
    maxInlineChars?: number
  },
): Promise<ApplyToolObservationBudgetResult> {
  const maxInline = options.maxInlineChars ?? MAX_INLINE_TOOL_CHARS
  const text = raw ?? ''

  if (text.includes('[tool_output_spilled ') || text.includes('[duplicate_of hash=')) {
    return { content: text, changed: false, spilled: false, duplicate: false }
  }

  const hash = hashToolContent(text)
  const firstStep = options.dedup.seen.get(hash)
  if (firstStep !== undefined && text.length > 256) {
    return {
      content: `[duplicate_of hash=${hash} first_at_step=${firstStep}]`,
      changed: true,
      spilled: false,
      duplicate: true,
    }
  }
  options.dedup.seen.set(hash, options.step)

  if (text.length <= maxInline) {
    return { content: text, changed: false, spilled: false, duplicate: false }
  }

  const prioritized = prioritizeErrorBlocks(text)

  if (options.spill) {
    const path = await options.spill.write(text)
    const hint = options.spill.hint(path)
    const preview = headTail(prioritized, SPILL_PREVIEW_EACH, SPILL_PREVIEW_EACH)
    const content = [
      `[tool_output_spilled path=${JSON.stringify(path)} chars=${text.length}]`,
      '已保存完整输出。需要细节时请用 read/grep/终端读取该路径。',
      hint,
      '--- preview (head + tail) ---',
      preview,
    ].join('\n')
    return { content, changed: true, spilled: true, duplicate: false }
  }

  return {
    content: headTail(prioritized, HEAD_TAIL_EACH, HEAD_TAIL_EACH),
    changed: true,
    spilled: false,
    duplicate: false,
  }
}

export function headTail(text: string, head: number, tail: number): string {
  if (text.length <= head + tail) return text
  const omitted = text.length - head - tail
  return `${text.slice(0, head)}\n…[${omitted} chars omitted]…\n${text.slice(-tail)}`
}

/**
 * 若含错误标记，优先保留匹配块及其前后各 ERROR_CONTEXT_LINES 行，再拼回全文供预算裁剪。
 * 无错误时原样返回。
 */
export function prioritizeErrorBlocks(text: string): string {
  const lines = text.split('\n')
  const keep = new Set<number>()
  let found = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (!ERROR_MARKERS.some((marker) => line.includes(marker))) continue
    found = true
    const from = Math.max(0, i - ERROR_CONTEXT_LINES)
    const to = Math.min(lines.length - 1, i + ERROR_CONTEXT_LINES)
    for (let j = from; j <= to; j += 1) keep.add(j)
  }
  if (!found || keep.size === 0) return text

  const parts: string[] = []
  let last = -2
  const sorted = [...keep].sort((a, b) => a - b)
  for (const index of sorted) {
    if (index > last + 1 && parts.length > 0) {
      parts.push('…[non-error lines omitted]…')
    }
    parts.push(lines[index]!)
    last = index
  }
  const extracted = parts.join('\n')
  // 若提取后仍很短，附上原文 head/tail 以便保留结构
  if (extracted.length < text.length * 0.3) {
    return `${extracted}\n\n--- full output (budgeted) ---\n${text}`
  }
  return extracted
}

export function formatSpillHint(path: string): string {
  const pathLit = JSON.stringify(path)
  return [
    `后续可用文件工具读取 ${pathLit}；`,
    `或检索：grep 错误关键字于该路径。`,
  ].join('\n')
}
