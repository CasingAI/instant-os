/**
 * 桌面应用搜索的分层匹配内核。
 *
 * 层级（tier 越小越靠前）：
 *   0 原名前缀          「天」→ 天气
 *   1 原名包含          「气时」→ 天气时钟
 *   2 全拼前缀          「shezhi」→ 设置
 *   3 全拼包含          「tongshe」→ 系统设置
 *   4 拼音简写          「sz」「shzh」「shez」→ 设置（连续音节、每段 ≥1 字母前缀）
 *   5 id 前缀           「set」→ settings
 *   6 id 包含           「ett」→ settings
 *   7 原名模糊子序列     「tqqq」类 ASCII 查询
 *   8 id 模糊子序列      「stgs」→ settings
 *
 * 拼音数据复用 vendor 的 pinyin-pro（纯 JS 词典，同步可用）；同层内按
 * 命中位置（tie）与目录原顺序稳定排序。纯逻辑模块，可 node 单测。
 */

import { pinyin } from '../vendor/pinyin-pro/index.mjs'
import type { DesktopAppSearchEntry } from './desktop-app-search.ts'

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/
const PLAIN_ASCII_QUERY_RE = /^[a-z0-9]+$/

export type AppSearchPinyinKeys = {
  /** 全拼小写连写：系统设置 → xitongshezhi */
  full: string
  /** 与 full 对齐的音节数组：['xi','tong','she','zhi'] */
  syllables: string[]
  /** 每个音节对应原名的码点（code point）下标 */
  syllableCharIndex: number[]
}

const pinyinKeysCache = new Map<string, AppSearchPinyinKeys | null>()

export function getAppSearchPinyinKeys(name: string): AppSearchPinyinKeys | null {
  if (!CJK_RE.test(name)) {
    return null
  }
  const cached = pinyinKeysCache.get(name)
  if (cached !== undefined) {
    return cached
  }
  const keys = buildAppSearchPinyinKeys(name)
  pinyinKeysCache.set(name, keys)
  return keys
}

function buildAppSearchPinyinKeys(name: string): AppSearchPinyinKeys | null {
  let parts: Array<{ origin: string; pinyin: string; isZh: boolean }>
  try {
    parts = pinyin(name, { toneType: 'none', type: 'all', v: true, nonZh: 'consecutive' })
  } catch {
    return null
  }
  const syllables: string[] = []
  const syllableCharIndex: number[] = []
  let cursor = 0
  for (const part of parts) {
    const originLength = [...part.origin].length
    if (part.isZh && part.pinyin) {
      const partSyllables = part.pinyin.split(/\s+/).filter(Boolean)
      if (partSyllables.length === originLength) {
        for (let k = 0; k < partSyllables.length; k += 1) {
          syllables.push(partSyllables[k]!)
          syllableCharIndex.push(cursor + k)
        }
      } else if (partSyllables.length > 0) {
        // 分词异常兜底：整词当一个音节，简拼对齐退化但不至于失配
        syllables.push(partSyllables.join(''))
        syllableCharIndex.push(cursor)
      }
    }
    cursor += originLength
  }
  if (syllables.length === 0) {
    return null
  }
  return { full: syllables.join(''), syllables, syllableCharIndex }
}

export type AppSearchMatch = {
  entry: DesktopAppSearchEntry
  tier: number
  /** 同层内排序依据（越小越靠前）：命中起始下标或起始音节 */
  tie: number
  /** 原名上的命中高亮区间（码点下标，[start, end)），空数组表示不高亮 */
  nameRanges: Array<[number, number]>
  /** id 上的命中高亮区间（UTF-16 下标，[start, end)） */
  idRanges: Array<[number, number]>
}

export const APP_SEARCH_TIERS = {
  namePrefix: 0,
  nameContains: 1,
  pinyinPrefix: 2,
  pinyinContains: 3,
  pinyinAbbrev: 4,
  idPrefix: 5,
  idContains: 6,
  fuzzyName: 7,
  fuzzyId: 8,
} as const

export function rankDesktopAppSearchEntry(
  entry: DesktopAppSearchEntry,
  query: string,
): AppSearchMatch | undefined {
  const q = query.trim().toLowerCase()
  if (!q) {
    return undefined
  }

  const nameLower = entry.name.toLowerCase()
  const nameIndex = nameLower.indexOf(q)
  if (nameIndex === 0) {
    return {
      entry,
      tier: APP_SEARCH_TIERS.namePrefix,
      tie: 0,
      nameRanges: [[0, [...q].length]],
      idRanges: [],
    }
  }
  if (nameIndex > 0) {
    return {
      entry,
      tier: APP_SEARCH_TIERS.nameContains,
      tie: nameIndex,
      nameRanges: [[nameIndex, nameIndex + [...q].length]],
      idRanges: [],
    }
  }

  const keys = getAppSearchPinyinKeys(entry.name)
  if (keys) {
    if (keys.full.startsWith(q)) {
      const [start, end] = pinyinLetterRangeToCharRange(keys, 0, q.length)
      return {
        entry,
        tier: APP_SEARCH_TIERS.pinyinPrefix,
        tie: 0,
        nameRanges: [[start, end]],
        idRanges: [],
      }
    }
    const fullIndex = keys.full.indexOf(q)
    if (fullIndex > 0) {
      const [start, end] = pinyinLetterRangeToCharRange(keys, fullIndex, fullIndex + q.length)
      return {
        entry,
        tier: APP_SEARCH_TIERS.pinyinContains,
        tie: fullIndex,
        nameRanges: [[start, end]],
        idRanges: [],
      }
    }
    const abbrev = pinyinAbbrevMatch(keys, q)
    if (abbrev) {
      return {
        entry,
        tier: APP_SEARCH_TIERS.pinyinAbbrev,
        tie: abbrev.startSyllable,
        nameRanges: abbrev.nameRanges,
        idRanges: [],
      }
    }
  }

  const idLower = entry.id.toLowerCase()
  const idIndex = idLower.indexOf(q)
  if (idIndex === 0) {
    return {
      entry,
      tier: APP_SEARCH_TIERS.idPrefix,
      tie: 0,
      nameRanges: [],
      idRanges: [[0, q.length]],
    }
  }
  if (idIndex > 0) {
    return {
      entry,
      tier: APP_SEARCH_TIERS.idContains,
      tie: idIndex,
      nameRanges: [],
      idRanges: [[idIndex, idIndex + q.length]],
    }
  }

  if (PLAIN_ASCII_QUERY_RE.test(q)) {
    const fuzzyName = fuzzySubsequence(nameLower, q)
    if (fuzzyName) {
      return {
        entry,
        tier: APP_SEARCH_TIERS.fuzzyName,
        tie: fuzzyName.score,
        nameRanges: fuzzyName.positions.map<[number, number]>((p) => [p, p + 1]),
        idRanges: [],
      }
    }
    const fuzzyId = fuzzySubsequence(idLower, q)
    if (fuzzyId) {
      return {
        entry,
        tier: APP_SEARCH_TIERS.fuzzyId,
        tie: fuzzyId.score,
        nameRanges: [],
        idRanges: fuzzyId.positions.map<[number, number]>((p) => [p, p + 1]),
      }
    }
  }

  return undefined
}

/** 全拼字母区间 [from, to) → 原名汉字码点区间（跨到的汉字整字高亮） */
function pinyinLetterRangeToCharRange(
  keys: AppSearchPinyinKeys,
  from: number,
  to: number,
): [number, number] {
  let acc = 0
  let startChar = keys.syllableCharIndex[0] ?? 0
  let endChar = startChar + 1
  for (let i = 0; i < keys.syllables.length; i += 1) {
    const syllable = keys.syllables[i]!
    const s = acc
    const e = acc + syllable.length
    if (from >= s && from < e) {
      startChar = keys.syllableCharIndex[i]!
    }
    if (to > s && to <= e) {
      endChar = keys.syllableCharIndex[i]! + 1
    }
    acc = e
  }
  return [startChar, endChar]
}

type PinyinAbbrevMatch = {
  startSyllable: number
  nameRanges: Array<[number, number]>
}

/**
 * 拼音简写匹配：query 从某个音节开始，逐个消耗**连续**音节，每段是
 * 该音节的非空前缀（如 sz / shzh / shez / szi → she,zhi）。返回起始
 * 音节与被消耗音节对应的原名汉字高亮区间。
 */
function pinyinAbbrevMatch(keys: AppSearchPinyinKeys, query: string): PinyinAbbrevMatch | undefined {
  const { syllables } = keys
  for (let start = 0; start < syllables.length; start += 1) {
    const memo = new Map<number, boolean>()
    if (!abbrevCanMatchFrom(syllables, query, start, 0, memo)) {
      continue
    }
    const used: number[] = []
    let syllable = start
    let qi = 0
    while (qi < query.length && syllable < syllables.length) {
      const syl = syllables[syllable]!
      const max = Math.min(syl.length, query.length - qi)
      for (let len = 1; len <= max; len += 1) {
        if (!syl.startsWith(query.slice(qi, qi + len))) {
          break
        }
        if (abbrevCanMatchFrom(syllables, query, syllable + 1, qi + len, memo)) {
          used.push(syllable)
          qi += len
          break
        }
      }
      syllable += 1
    }
    if (qi === query.length && used.length > 0) {
      return { startSyllable: start, nameRanges: syllablesToCharRanges(keys, used) }
    }
  }
  return undefined
}

function abbrevCanMatchFrom(
  syllables: string[],
  query: string,
  syllableIndex: number,
  queryIndex: number,
  memo: Map<number, boolean>,
): boolean {
  if (queryIndex === query.length) {
    return true
  }
  if (syllableIndex === syllables.length) {
    return false
  }
  const key = syllableIndex * (query.length + 1) + queryIndex
  const cached = memo.get(key)
  if (cached !== undefined) {
    return cached
  }
  const syllable = syllables[syllableIndex]!
  const max = Math.min(syllable.length, query.length - queryIndex)
  let ok = false
  for (let len = 1; len <= max; len += 1) {
    if (!syllable.startsWith(query.slice(queryIndex, queryIndex + len))) {
      break
    }
    if (abbrevCanMatchFrom(syllables, query, syllableIndex + 1, queryIndex + len, memo)) {
      ok = true
      break
    }
  }
  memo.set(key, ok)
  return ok
}

/** 把用到的音节下标合并成原名汉字的连续高亮区间 */
function syllablesToCharRanges(
  keys: AppSearchPinyinKeys,
  usedSyllables: number[],
): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const syllable of usedSyllables) {
    const char = keys.syllableCharIndex[syllable]
    if (char === undefined) {
      continue
    }
    const last = ranges[ranges.length - 1]
    if (last && char === last[1]) {
      last[1] = char + 1
    } else {
      ranges.push([char, char + 1])
    }
  }
  return ranges
}

type FuzzyResult = {
  positions: number[]
  /** 越大越靠前：奖励连续与词首命中，惩罚命中位置靠后与跨度大 */
  score: number
}

/** fzf 风格子序列匹配（贪心最左）；全 ASCII 查询专用 */
function fuzzySubsequence(haystack: string, needle: string): FuzzyResult | undefined {
  const positions: number[] = []
  let from = 0
  for (const char of needle) {
    const at = haystack.indexOf(char, from)
    if (at === -1) {
      return undefined
    }
    positions.push(at)
    from = at + 1
  }
  let bonus = 0
  let prev = -2
  for (const p of positions) {
    if (p === prev + 1) {
      bonus += 3
    }
    if (p === 0 || !/[a-z0-9]/.test(haystack[p - 1] ?? '')) {
      bonus += 2
    }
    prev = p
  }
  const first = positions[0]!
  const last = positions[positions.length - 1]!
  const span = last - first + 1 - positions.length
  return { positions, score: bonus * 10 - first * 2 - span }
}
