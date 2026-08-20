/** 与 GitHub Desktop 统一视图对齐的行级 diff 模型与计算 */

export type GithubDiffLineKind = 'hunk' | 'context' | 'added' | 'deleted'

export type GithubDiffLine = {
  kind: GithubDiffLineKind
  /** 行正文；hunk 行为 `@@ -a,b +c,d @@` */
  text: string
  oldLineNumber?: number
  newLineNumber?: number
  /** 行内高亮区间（字符级），仅 added/deleted 可能有 */
  innerRange?: { start: number; length: number }
}

const DEFAULT_CONTEXT = 3
const MAX_INNER_LINE_LENGTH = 1024

/** 按 git 语义拆行：末尾换行不产生多余空行 */
export function splitDiffLines(text: string): string[] {
  if (text.length === 0) return []
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  if (normalized.endsWith('\n')) {
    lines.pop()
  }
  return lines
}

type DiffOp =
  | { type: 'equal'; oldIndex: number; newIndex: number; text: string }
  | { type: 'delete'; oldIndex: number; text: string }
  | { type: 'insert'; newIndex: number; text: string }

/** 单元格过大时退化为「整段替换」，避免 O(nm) 卡死 */
const MAX_LCS_CELLS = 2_000_000

/**
 * 基于 LCS 的行 diff。工作区文件通常远小于上限；
 * 过大时退化为整文件删除+新增（仍可浏览，只是 hunk 更粗）。
 */
function lineDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length
  const m = newLines.length
  if (n === 0 && m === 0) return []
  if (n === 0) {
    return newLines.map((text, newIndex) => ({ type: 'insert' as const, newIndex, text }))
  }
  if (m === 0) {
    return oldLines.map((text, oldIndex) => ({ type: 'delete' as const, oldIndex, text }))
  }

  if (n * m > MAX_LCS_CELLS) {
    return [
      ...oldLines.map((text, oldIndex) => ({ type: 'delete' as const, oldIndex, text })),
      ...newLines.map((text, newIndex) => ({ type: 'insert' as const, newIndex, text })),
    ]
  }

  const width = m + 1
  const dp = new Int32Array((n + 1) * width)
  for (let i = 1; i <= n; i++) {
    const row = i * width
    const prev = (i - 1) * width
    const oldLine = oldLines[i - 1]!
    for (let j = 1; j <= m; j++) {
      if (oldLine === newLines[j - 1]) {
        dp[row + j] = dp[prev + j - 1]! + 1
      } else {
        const up = dp[prev + j]!
        const left = dp[row + j - 1]!
        dp[row + j] = up >= left ? up : left
      }
    }
  }

  const ops: DiffOp[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({
        type: 'equal',
        oldIndex: i - 1,
        newIndex: j - 1,
        text: oldLines[i - 1]!,
      })
      i--
      j--
      continue
    }
    const up = i > 0 ? dp[(i - 1) * width + j]! : -1
    const left = j > 0 ? dp[i * width + (j - 1)]! : -1
    if (j > 0 && (i === 0 || left >= up)) {
      ops.push({ type: 'insert', newIndex: j - 1, text: newLines[j - 1]! })
      j--
    } else {
      ops.push({ type: 'delete', oldIndex: i - 1, text: oldLines[i - 1]! })
      i--
    }
  }
  ops.reverse()
  return ops
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a[i] === b[i]) i++
  return i
}

function commonSuffixLength(a: string, b: string, prefixLen: number): number {
  const max = Math.min(a.length - prefixLen, b.length - prefixLen)
  let i = 0
  while (
    i < max &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i++
  }
  return i
}

/** 官方同款：公共前后缀之外的中间段标为行内差异 */
function relativeInnerRange(
  deleted: string,
  added: string,
): { deleted?: { start: number; length: number }; added?: { start: number; length: number } } {
  if (
    !deleted ||
    !added ||
    deleted.length > MAX_INNER_LINE_LENGTH ||
    added.length > MAX_INNER_LINE_LENGTH ||
    deleted === added
  ) {
    return {}
  }
  const prefix = commonPrefixLength(deleted, added)
  const suffix = commonSuffixLength(deleted, added, prefix)
  const delLen = deleted.length - prefix - suffix
  const addLen = added.length - prefix - suffix
  return {
    deleted: delLen > 0 ? { start: prefix, length: delLen } : undefined,
    added: addLen > 0 ? { start: prefix, length: addLen } : undefined,
  }
}

function formatHunkHeader(
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number,
): string {
  const oldPart = oldCount === 1 ? `-${oldStart}` : `-${oldStart},${oldCount}`
  const newPart = newCount === 1 ? `+${newStart}` : `+${newStart},${newCount}`
  return `@@ ${oldPart} ${newPart} @@`
}

/**
 * 将全量 ops 收成带 context 的 hunk 行列表（省略远处未改行）。
 */
function opsToHunkLines(ops: DiffOp[], contextLines: number): GithubDiffLine[] {
  if (ops.length === 0) return []

  type ChangeSpan = { start: number; end: number }
  const changeSpans: ChangeSpan[] = []
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]!.type !== 'equal') {
      const start = i
      while (i + 1 < ops.length && ops[i + 1]!.type !== 'equal') i++
      changeSpans.push({ start, end: i })
    }
  }

  if (changeSpans.length === 0) {
    return []
  }

  type HunkRange = { opStart: number; opEnd: number }
  const hunks: HunkRange[] = []
  for (const span of changeSpans) {
    const opStart = Math.max(0, span.start - contextLines)
    const opEnd = Math.min(ops.length - 1, span.end + contextLines)
    const prev = hunks[hunks.length - 1]
    if (prev && opStart <= prev.opEnd + 1) {
      prev.opEnd = Math.max(prev.opEnd, opEnd)
    } else {
      hunks.push({ opStart, opEnd })
    }
  }

  const result: GithubDiffLine[] = []

  for (const hunk of hunks) {
    const slice = ops.slice(hunk.opStart, hunk.opEnd + 1)
    let oldCount = 0
    let newCount = 0
    let oldStart = 0
    let newStart = 0
    let sawOld = false
    let sawNew = false

    for (const op of slice) {
      if (op.type === 'equal') {
        if (!sawOld) {
          oldStart = op.oldIndex + 1
          sawOld = true
        }
        if (!sawNew) {
          newStart = op.newIndex + 1
          sawNew = true
        }
        oldCount++
        newCount++
      } else if (op.type === 'delete') {
        if (!sawOld) {
          oldStart = op.oldIndex + 1
          sawOld = true
        }
        oldCount++
      } else {
        if (!sawNew) {
          newStart = op.newIndex + 1
          sawNew = true
        }
        newCount++
      }
    }

    if (!sawOld) oldStart = oldCount === 0 ? 0 : 1
    if (!sawNew) newStart = newCount === 0 ? 0 : 1

    result.push({
      kind: 'hunk',
      text: formatHunkHeader(oldStart, oldCount, newStart, newCount),
    })

    // 成对 delete/insert 上做行内高亮（数量相等时按索引配对）
    let i = 0
    while (i < slice.length) {
      if (slice[i]!.type === 'equal') {
        const op = slice[i]! as Extract<DiffOp, { type: 'equal' }>
        result.push({
          kind: 'context',
          text: op.text,
          oldLineNumber: op.oldIndex + 1,
          newLineNumber: op.newIndex + 1,
        })
        i++
        continue
      }

      const deletes: Extract<DiffOp, { type: 'delete' }>[] = []
      const inserts: Extract<DiffOp, { type: 'insert' }>[] = []
      while (i < slice.length && slice[i]!.type === 'delete') {
        deletes.push(slice[i]! as Extract<DiffOp, { type: 'delete' }>)
        i++
      }
      while (i < slice.length && slice[i]!.type === 'insert') {
        inserts.push(slice[i]! as Extract<DiffOp, { type: 'insert' }>)
        i++
      }

      const pairCount = Math.min(deletes.length, inserts.length)
      for (let p = 0; p < pairCount; p++) {
        const del = deletes[p]!
        const ins = inserts[p]!
        const inner = relativeInnerRange(del.text, ins.text)
        result.push({
          kind: 'deleted',
          text: del.text,
          oldLineNumber: del.oldIndex + 1,
          innerRange: inner.deleted,
        })
        result.push({
          kind: 'added',
          text: ins.text,
          newLineNumber: ins.newIndex + 1,
          innerRange: inner.added,
        })
      }
      for (let p = pairCount; p < deletes.length; p++) {
        const del = deletes[p]!
        result.push({
          kind: 'deleted',
          text: del.text,
          oldLineNumber: del.oldIndex + 1,
        })
      }
      for (let p = pairCount; p < inserts.length; p++) {
        const ins = inserts[p]!
        result.push({
          kind: 'added',
          text: ins.text,
          newLineNumber: ins.newIndex + 1,
        })
      }
    }
  }

  return result
}

/** 从两侧全文计算 unified 风格展示行（省略远处未改内容） */
export function buildUnifiedDiffLines(
  original: string,
  modified: string,
  contextLines: number = DEFAULT_CONTEXT,
): GithubDiffLine[] {
  const oldLines = splitDiffLines(original)
  const newLines = splitDiffLines(modified)
  if (oldLines.length === 0 && newLines.length === 0) {
    return []
  }
  const ops = lineDiff(oldLines, newLines)
  return opsToHunkLines(ops, contextLines)
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * 解析 GitHub Commit API / unified patch 文本为展示行。
 * 会跳过 `diff --git` / `---` / `+++` / `index` 等文件头。
 */
export function parseUnifiedPatch(patch: string): GithubDiffLine[] {
  const rawLines = patch.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result: GithubDiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const raw of rawLines) {
    const hunkMatch = HUNK_HEADER_RE.exec(raw)
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1])
      newLine = Number(hunkMatch[3])
      inHunk = true
      result.push({ kind: 'hunk', text: raw })
      continue
    }

    if (!inHunk) {
      // 文件头或噪声
      if (
        raw.startsWith('diff --git') ||
        raw.startsWith('index ') ||
        raw.startsWith('---') ||
        raw.startsWith('+++') ||
        raw.startsWith('new file') ||
        raw.startsWith('deleted file') ||
        raw.startsWith('similarity index') ||
        raw.startsWith('rename from') ||
        raw.startsWith('rename to') ||
        raw.startsWith('Binary files')
      ) {
        continue
      }
      continue
    }

    if (raw.startsWith('\\')) {
      // "\ No newline at end of file"
      continue
    }

    const prefix = raw[0]
    const text = raw.length > 0 ? raw.slice(1) : ''

    if (prefix === '+') {
      result.push({ kind: 'added', text, newLineNumber: newLine })
      newLine++
    } else if (prefix === '-') {
      result.push({ kind: 'deleted', text, oldLineNumber: oldLine })
      oldLine++
    } else if (prefix === ' ' || prefix === undefined) {
      result.push({
        kind: 'context',
        text: prefix === ' ' ? text : raw,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      })
      oldLine++
      newLine++
    } else {
      // 容错：无前缀当 context
      result.push({
        kind: 'context',
        text: raw,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      })
      oldLine++
      newLine++
    }
  }

  // 对成对 delete/insert 补行内高亮
  return applyInnerHighlights(result)
}

function applyInnerHighlights(lines: GithubDiffLine[]): GithubDiffLine[] {
  const out = lines.slice()
  let i = 0
  while (i < out.length) {
    if (out[i]!.kind === 'hunk' || out[i]!.kind === 'context') {
      i++
      continue
    }
    const delStart = i
    while (i < out.length && out[i]!.kind === 'deleted') i++
    const delEnd = i
    const addStart = i
    while (i < out.length && out[i]!.kind === 'added') i++
    const addEnd = i
    const delCount = delEnd - delStart
    const addCount = addEnd - addStart
    const pair = Math.min(delCount, addCount)
    for (let p = 0; p < pair; p++) {
      const del = out[delStart + p]!
      const add = out[addStart + p]!
      const inner = relativeInnerRange(del.text, add.text)
      if (inner.deleted) out[delStart + p] = { ...del, innerRange: inner.deleted }
      if (inner.added) out[addStart + p] = { ...add, innerRange: inner.added }
    }
  }
  return out
}

/** gutter 宽度：至少 3 位数字宽度 */
export function diffLineNumberWidth(lines: readonly GithubDiffLine[]): number {
  let max = 0
  for (const line of lines) {
    if (line.oldLineNumber !== undefined) max = Math.max(max, line.oldLineNumber)
    if (line.newLineNumber !== undefined) max = Math.max(max, line.newLineNumber)
  }
  const digits = Math.max(3, String(max).length)
  return digits * 10 + 5
}
