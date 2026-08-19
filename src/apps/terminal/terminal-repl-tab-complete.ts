/**
 * InstantREPL Tab 补全：按光标处标识符链，在 QuickJS 里只读扫属性。
 * 多候选时填入当前项并在输入框旁提示，再按 Tab 循环切换。
 */

export const HOST_REPL_DOT_COMMANDS = ['.reset'] as const

export type ReplCompletionTarget = {
  /** 空字符串表示从 globalThis 补全 */
  objectExpr: string
  prefix: string
  /** 草稿中被替换片段的起始下标 */
  from: number
  /** 草稿中被替换片段的结束下标（不含） */
  to: number
}

export type ReplCompletionCycle = {
  head: string
  tail: string
  prefix: string
  matches: string[]
  index: number
}

const IDENT = /[A-Za-z_$][\w$]*$/
const IDENT_CHAIN = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/
const IDENT_CONTINUE = /[A-Za-z0-9_$]/
const TRAILING_SKIP = /[\s)\]}]/

/** 客侧：沿标识符链安全取值后列出可点属性（不含 getter 展开、不含 `__` / constructor / Object.prototype）。 */
const REPL_COMPLETION_GUEST_SOURCE = `function (parts) {
  function hasGetter(desc) {
    return desc && typeof desc.get === 'function';
  }
  function lookup(current, name) {
    var obj = current;
    var depth = 0;
    while (obj != null && depth < 24) {
      var desc;
      try {
        desc = Object.getOwnPropertyDescriptor(obj, name);
      } catch (e) {
        return { ok: false };
      }
      if (desc) {
        if (hasGetter(desc) || !('value' in desc)) return { ok: false };
        return { ok: true, value: desc.value };
      }
      try {
        obj = Object.getPrototypeOf(obj);
      } catch (e) {
        return { ok: false };
      }
      depth++;
    }
    return { ok: false };
  }
  var current = globalThis;
  for (var i = 0; i < parts.length; i++) {
    var step = lookup(current, parts[i]);
    if (!step.ok) return [];
    current = step.value;
  }
  if (current == null) return [];
  var kind = typeof current;
  if (kind !== 'object' && kind !== 'function') {
    try {
      current = Object(current);
    } catch (e) {
      return [];
    }
  }
  var objectProto = Object.prototype;
  var names = [];
  var seen = Object.create(null);
  var walk = current;
  var depth = 0;
  while (walk != null && walk !== objectProto && depth < 24) {
    var own;
    try {
      own = Object.getOwnPropertyNames(walk);
    } catch (e) {
      break;
    }
    for (var j = 0; j < own.length; j++) {
      var n = own[j];
      if (seen[n]) continue;
      seen[n] = true;
      if (n === 'constructor') continue;
      if (n.length >= 2 && n.charAt(0) === '_' && n.charAt(1) === '_') continue;
      if (/^[0-9]+$/.test(n)) continue;
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) continue;
      if (kind === 'function' && (n === 'arguments' || n === 'caller')) continue;
      names.push(n);
    }
    try {
      walk = Object.getPrototypeOf(walk);
    } catch (e) {
      break;
    }
    depth++;
  }
  names.sort();
  return names;
}`

function clampCursor(line: string, cursor: number): number {
  if (cursor < 0) return 0
  if (cursor > line.length) return line.length
  return cursor
}

/** 光标在 `)` 等闭合符上时，回退到前面的标识符再补全。 */
function skipTrailingClosers(line: string, cursor: number): number {
  let pos = clampCursor(line, cursor)
  while (pos > 0 && TRAILING_SKIP.test(line.charAt(pos - 1))) {
    pos -= 1
  }
  return pos
}

function extendIdentEnd(line: string, pos: number): number {
  let to = pos
  while (to < line.length && IDENT_CONTINUE.test(line.charAt(to))) {
    to += 1
  }
  return to
}

function filterByPrefix(candidates: readonly string[], prefix: string): string[] {
  if (!prefix) return [...candidates]
  const lower = prefix.toLowerCase()
  return candidates.filter(
    (item) => item.startsWith(prefix) || item.toLowerCase().startsWith(lower),
  )
}

function parseMemberObjectExpr(objectPart: string): string | undefined {
  const chainMatch = objectPart.match(IDENT_CHAIN)
  if (!chainMatch) return undefined
  const objectExpr = chainMatch[0] ?? ''
  if (!objectExpr) return undefined
  const chainStart = objectPart.length - objectExpr.length
  if (chainStart > 0) {
    const prev = objectPart.charAt(chainStart - 1)
    if (prev === '?' || prev === '.' || /[A-Za-z0-9_$]/.test(prev)) {
      return undefined
    }
  }
  return objectExpr
}

function parseFromLeft(left: string, pos: number, to: number): ReplCompletionTarget | undefined {
  if (left.length === 0) {
    return { objectExpr: '', prefix: '', from: pos, to }
  }

  const identMatch = left.match(IDENT)
  if (identMatch) {
    const prefix = identMatch[0] ?? ''
    const from = pos - prefix.length
    const before = left.slice(0, from)
    if (before.endsWith('.')) {
      const objectExpr = parseMemberObjectExpr(before.slice(0, -1))
      if (objectExpr === undefined) return undefined
      return { objectExpr, prefix, from, to }
    }
    if (from > 0 && /[A-Za-z0-9_$]/.test(left.charAt(from - 1))) {
      return undefined
    }
    return { objectExpr: '', prefix, from, to }
  }

  if (left.endsWith('.')) {
    const objectExpr = parseMemberObjectExpr(left.slice(0, -1))
    if (objectExpr === undefined) return undefined
    return { objectExpr, prefix: '', from: pos, to }
  }

  return undefined
}

/**
 * 解析光标处的 `ident` 或 `a.b.c`（只允许 Identifier + `.`）。
 * `console.log(glo)` 光标在 `glo` 后或行尾 `)` 上都能识别。
 */
export function parseReplCompletionTarget(
  line: string,
  cursor: number = line.length,
): ReplCompletionTarget | undefined {
  const pos = skipTrailingClosers(line, cursor)
  const to = extendIdentEnd(line, pos)
  return parseFromLeft(line.slice(0, pos), pos, to)
}

export function parseHostDotTarget(
  line: string,
  cursor: number = line.length,
): ReplCompletionTarget | undefined {
  const pos = skipTrailingClosers(line, cursor)
  const left = line.slice(0, pos)
  const match = left.match(/^(\s*)(\.\w*)$/)
  if (!match) return undefined
  const prefix = match[2] ?? '.'
  const from = (match[1] ?? '').length
  return { objectExpr: '', prefix, from, to: extendIdentEnd(line, pos) }
}

export function isHostDotCommandLine(line: string, cursor: number = line.length): boolean {
  return parseHostDotTarget(line, cursor) !== undefined
}

export function draftFromReplCompletionCycle(cycle: ReplCompletionCycle): string {
  const name = cycle.matches[cycle.index] ?? ''
  return `${cycle.head}${name}${cycle.tail}`
}

export function caretFromReplCompletionCycle(cycle: ReplCompletionCycle): number {
  const name = cycle.matches[cycle.index] ?? ''
  return cycle.head.length + name.length
}

export function formatReplCompletionHint(cycle: ReplCompletionCycle): string {
  if (cycle.matches.length <= 1) return ''
  const rest = cycle.matches.filter((_, index) => index !== cycle.index)
  const shown = rest.slice(0, 6)
  const extra = rest.length > shown.length ? ' …' : ''
  return `${cycle.index + 1}/${cycle.matches.length}  ${shown.join('  ')}${extra}`
}

export function stepReplCompletionCycle(
  cycle: ReplCompletionCycle,
  direction: 1 | -1,
): ReplCompletionCycle {
  const len = cycle.matches.length
  if (len === 0) return cycle
  const next = (cycle.index + direction + len) % len
  return { ...cycle, index: next }
}

export function cycleMatchesDraft(cycle: ReplCompletionCycle, draft: string): boolean {
  return draftFromReplCompletionCycle(cycle) === draft
}

export function createReplCompletionCycle(
  line: string,
  target: ReplCompletionTarget,
  names: readonly string[],
  direction: 1 | -1,
): ReplCompletionCycle | undefined {
  const matches = filterByPrefix(names, target.prefix)
  if (matches.length === 0) return undefined
  const index = direction === -1 ? matches.length - 1 : 0
  return {
    head: line.slice(0, target.from),
    tail: line.slice(target.to),
    prefix: target.prefix,
    matches,
    index,
  }
}

/** 生成在 guest 里 eval 的 IIFE；`objectExpr` 须已通过 parse（纯标识符链）。 */
export function buildReplCompletionEval(objectExpr: string): string {
  const parts = objectExpr === '' ? [] : objectExpr.split('.')
  return `(${REPL_COMPLETION_GUEST_SOURCE})(${JSON.stringify(parts)})`
}
