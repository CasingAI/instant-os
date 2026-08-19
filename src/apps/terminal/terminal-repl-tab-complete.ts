/**
 * InstantREPL Tab 补全：解析末尾标识符链，在 QuickJS 里只读扫属性。
 * 对齐 Node REPL：唯一填入；多候选先拉公共前缀，已是公共前缀则列出。
 */

export const HOST_REPL_DOT_COMMANDS = ['.reset'] as const

export type ReplCompletionTarget = {
  /** 空字符串表示从 globalThis 补全 */
  objectExpr: string
  prefix: string
  /** 草稿中 prefix 的起始下标（替换点） */
  from: number
}

export type ReplTabCompleteResult = {
  nextDraft: string
  candidates?: string[]
}

const IDENT = /[A-Za-z_$][\w$]*$/
const IDENT_CHAIN = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/

/** 客侧：沿标识符链安全取值后列出可点属性（不含 getter 展开、不含 `__` 内部键）。 */
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
  var names = [];
  var seen = Object.create(null);
  var walk = current;
  var depth = 0;
  while (walk != null && depth < 24) {
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

function commonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0] ?? ''
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index] ?? ''
    let end = 0
    while (end < prefix.length && end < value.length && prefix[end] === value[end]) {
      end += 1
    }
    prefix = prefix.slice(0, end)
    if (!prefix) break
  }
  return prefix
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

/**
 * 解析当前行末尾的 `ident` 或 `a.b.c`（只允许 Identifier + `.`）。
 * 含调用 / `[]` / `?.` 的对象表达式返回 undefined。
 */
export function parseReplCompletionTarget(line: string): ReplCompletionTarget | undefined {
  if (line.length === 0) {
    return { objectExpr: '', prefix: '', from: 0 }
  }

  const identMatch = line.match(IDENT)
  if (identMatch) {
    const prefix = identMatch[0] ?? ''
    const from = line.length - prefix.length
    const left = line.slice(0, from)
    if (left.endsWith('.')) {
      const objectExpr = parseMemberObjectExpr(left.slice(0, -1))
      if (objectExpr === undefined) return undefined
      return { objectExpr, prefix, from }
    }
    if (from > 0 && /[A-Za-z0-9_$]/.test(line.charAt(from - 1))) {
      return undefined
    }
    return { objectExpr: '', prefix, from }
  }

  if (line.endsWith('.')) {
    const objectExpr = parseMemberObjectExpr(line.slice(0, -1))
    if (objectExpr === undefined) return undefined
    return { objectExpr, prefix: '', from: line.length }
  }

  return undefined
}

export function isHostDotCommandLine(line: string): boolean {
  return /^\s*\.\w*$/.test(line)
}

export function completeHostDotCommands(line: string): ReplTabCompleteResult {
  const match = line.match(/^(\s*)(\.\w*)$/)
  if (!match) return { nextDraft: line }
  const indent = match[1] ?? ''
  const token = match[2] ?? '.'
  return applyReplCompletion(line, indent.length, token, HOST_REPL_DOT_COMMANDS)
}

/** 生成在 guest 里 eval 的 IIFE；`objectExpr` 须已通过 parse（纯标识符链）。 */
export function buildReplCompletionEval(objectExpr: string): string {
  const parts = objectExpr === '' ? [] : objectExpr.split('.')
  return `(${REPL_COMPLETION_GUEST_SOURCE})(${JSON.stringify(parts)})`
}

export function applyReplCompletion(
  draft: string,
  from: number,
  prefix: string,
  names: readonly string[],
): ReplTabCompleteResult {
  const matches = filterByPrefix(names, prefix)
  if (matches.length === 0) {
    return { nextDraft: draft }
  }
  if (matches.length === 1) {
    const only = matches[0]
    if (only === undefined) return { nextDraft: draft }
    return { nextDraft: `${draft.slice(0, from)}${only}` }
  }
  const shared = commonPrefix(matches)
  if (shared.length > prefix.length) {
    return { nextDraft: `${draft.slice(0, from)}${shared}` }
  }
  return { nextDraft: draft, candidates: matches }
}
