/**
 * 注册表管理器：把 JSON 值当作树来浏览 / 按路径改写。
 * 不改存储层；路径失效时返回 undefined，由 UI 退回合法前缀。
 */

export type JsonPath = string[]

export type JsonNodeKind =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'invalid'

export type JsonParseResult = { ok: true; value: unknown } | { ok: false }

export type JsonChild = {
  key: string
  value: unknown
  kind: JsonNodeKind
  label: string
  summary: string
}

export type EditorDraftResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

const SUMMARY_MAX = 80
const ARRAY_SUMMARY_KEYS = ['title', 'name', 'id', 'key'] as const

export function parseJsonValue(raw: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false }
  }
}

export function isJsonContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

export function jsonNodeKind(value: unknown): JsonNodeKind {
  if (Array.isArray(value)) {
    return 'array'
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'object') {
    return 'object'
  }
  if (typeof value === 'string') {
    return 'string'
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return 'number'
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  return 'invalid'
}

export function jsonKindLabel(kind: JsonNodeKind): string {
  if (kind === 'object') {
    return '对象'
  }
  if (kind === 'array') {
    return '数组'
  }
  if (kind === 'string') {
    return '字符串'
  }
  if (kind === 'number') {
    return '数字'
  }
  if (kind === 'boolean') {
    return '布尔'
  }
  if (kind === 'null') {
    return '空值'
  }
  return '无效'
}

export function jsonOpenMode(
  raw: string,
  valueType: 'text' | 'json' | 'untyped',
): 'browse' | 'edit' {
  if (valueType !== 'json') {
    return 'edit'
  }
  const parsed = parseJsonValue(raw)
  if (!parsed.ok || !isJsonContainer(parsed.value)) {
    return 'edit'
  }
  return 'browse'
}

function parseArrayIndex(segment: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(segment)) {
    return undefined
  }
  const index = Number(segment)
  if (!Number.isSafeInteger(index)) {
    return undefined
  }
  return index
}

export function getAtPath(root: unknown, path: JsonPath): unknown {
  let current = root
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(segment)
      if (index === undefined || index < 0 || index >= current.length) {
        return undefined
      }
      current = current[index]
      continue
    }
    if (typeof current === 'object' && current !== null) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return undefined
      }
      current = (current as Record<string, unknown>)[segment]
      continue
    }
    return undefined
  }
  return current
}

export function setAtPath(
  root: unknown,
  path: JsonPath,
  next: unknown,
): unknown | undefined {
  if (path.length === 0) {
    return next
  }
  const [head, ...rest] = path
  if (head === undefined) {
    return undefined
  }
  if (Array.isArray(root)) {
    const index = parseArrayIndex(head)
    if (index === undefined || index < 0 || index >= root.length) {
      return undefined
    }
    const child = setAtPath(root[index], rest, next)
    if (child === undefined && rest.length > 0) {
      return undefined
    }
    const copy = root.slice()
    copy[index] = child
    return copy
  }
  if (typeof root === 'object' && root !== null) {
    const record = root as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, head)) {
      return undefined
    }
    const child = setAtPath(record[head], rest, next)
    if (child === undefined && rest.length > 0) {
      return undefined
    }
    return { ...record, [head]: child }
  }
  return undefined
}

export function longestValidPrefix(root: unknown, path: JsonPath): JsonPath {
  const valid: JsonPath = []
  for (const segment of path) {
    const next = [...valid, segment]
    if (getAtPath(root, next) === undefined) {
      break
    }
    valid.push(segment)
  }
  return valid
}

function truncateText(value: string, max = SUMMARY_MAX): string {
  if (value.length <= max) {
    return value
  }
  return `${value.slice(0, max)}…`
}

export function summarizeJson(value: unknown): string {
  const kind = jsonNodeKind(value)
  if (kind === 'object') {
    return `{${Object.keys(value as object).length} 个键}`
  }
  if (kind === 'array') {
    return `[${(value as unknown[]).length} 项]`
  }
  if (kind === 'string') {
    return truncateText(value as string)
  }
  if (kind === 'number' || kind === 'boolean') {
    return String(value)
  }
  if (kind === 'null') {
    return 'null'
  }
  return '—'
}

function summarizeArrayItem(value: unknown): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of ARRAY_SUMMARY_KEYS) {
      const field = record[key]
      if (typeof field === 'string' && field.length > 0) {
        return truncateText(field)
      }
    }
  }
  return summarizeJson(value)
}

export function listJsonChildren(value: unknown): JsonChild[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      key: String(index),
      value: item,
      kind: jsonNodeKind(item),
      label: `[${index}]`,
      summary: summarizeArrayItem(item),
    }))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({
      key,
      value: item,
      kind: jsonNodeKind(item),
      label: key,
      summary: summarizeJson(item),
    }))
  }
  return []
}

export function pathTitle(key: string, path: JsonPath, root: unknown): string {
  if (path.length === 0) {
    return key
  }
  const segment = path[path.length - 1]
  if (segment === undefined) {
    return key
  }
  const parent = getAtPath(root, path.slice(0, -1))
  if (Array.isArray(parent)) {
    return `[${segment}]`
  }
  return segment
}

export function formatNodeForEditor(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export function parseEditorDraft(
  kind: JsonNodeKind,
  draft: string,
): EditorDraftResult {
  if (kind === 'string') {
    return { ok: true, value: draft }
  }
  if (kind === 'number') {
    try {
      const parsed = JSON.parse(draft) as unknown
      if (typeof parsed === 'number' && Number.isFinite(parsed)) {
        return { ok: true, value: parsed }
      }
    } catch {
      // fall through
    }
    return { ok: false, error: '需要有效数字' }
  }
  if (kind === 'boolean') {
    const trimmed = draft.trim()
    if (trimmed === 'true') {
      return { ok: true, value: true }
    }
    if (trimmed === 'false') {
      return { ok: true, value: false }
    }
    return { ok: false, error: '需要 true 或 false' }
  }
  if (kind === 'null') {
    if (draft.trim() === 'null') {
      return { ok: true, value: null }
    }
    return { ok: false, error: '需要 null' }
  }
  try {
    return { ok: true, value: JSON.parse(draft) as unknown }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: 'JSON 格式无效' }
  }
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

export function nodeByteLength(value: unknown): number {
  if (typeof value === 'string') {
    return utf8Length(value)
  }
  try {
    return utf8Length(JSON.stringify(value) ?? '')
  } catch {
    return 0
  }
}
