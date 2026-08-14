/**
 * 歌词 → 模型 token id 序列（Zipformer-CTC 强制对齐的歌词侧编码）。
 *
 * 支持两种词表：
 *  - zh：字节 BPE（sherpa-onnx zipformer-ctc-zh），歌词按 UTF-8 字节映射
 *    BYTE_TO_CHAR 表后贪心最长前缀匹配（见 bbpe-decode.ts 的 encodeTextToBpeChars）。
 *  - en：全大写字符级 BPE（sherpa-onnx zipformer-ctc-en，LibriSpeech 大写惯例），
 *    歌词逐字符转大写后按词表子词/整词贪心匹配。
 *
 * 分词对齐：token 不允许跨「歌词单元」（tokenizeLyricsLine 规则：中文一字、
 * 英文一词、标点一符号），保证每个 token 唯一属于一个单元。词边界标记
 * （空白映射的 ▁ 与行首伪 ▁）单独成 token 时剔除，不进入 Viterbi。
 * 完全无法编码的单元记录为 unencodableUnits，聚合阶段用相邻单元插值兜底。
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

import { BYTE_TO_CHAR } from './bbpe-decode.ts'
import { tokenizeLyricsLine } from './align-g2p.ts'

/** 词表：模型 tokens.txt 的 id↔字符串映射 + 贪心匹配上界 */
export type VocabTable = {
  /** id → token 字符串（id 即模型输出类别） */
  tokens: string[]
  /** token 字符串 → id */
  ids: Map<string, number>
  /** 词表 token 最大字符长度 */
  maxLen: number
}

export function buildVocab(tokens: string[]): VocabTable {
  const ids = new Map<string, number>()
  let maxLen = 0
  for (let id = 0; id < tokens.length; id++) {
    const t = tokens[id]
    if (!t) continue
    ids.set(t, id)
    maxLen = Math.max(maxLen, Array.from(t).length)
  }
  return { tokens, ids, maxLen }
}

/** 词表模式：zh = 字节 BPE（中文模型），en = 大写字符 BPE（英文模型） */
export type AlignVocabMode = 'zh' | 'en'

/** 一行歌词的编码结果 */
export type EncodedLine = {
  line: string
  /** 歌词单元（tokenizeLyricsLine 规则） */
  units: string[]
  /** 进入 Viterbi 的 token id 序列（词边界/空白 token 已剔除） */
  tokenIds: number[]
  /** 每个 token 所属单元下标（与 units 对齐） */
  tokenUnits: number[]
  /** 完全无法编码的单元下标（聚合时插值） */
  unencodableUnits: number[]
}

/**
 * 逐原文字符划分单元（与 tokenizeLyricsLine 同规则），同时记录每个字符
 * 所属单元（空白 = -1）。
 */
function buildCharUnits(chars: string[]): { units: string[]; unitOfChar: number[] } {
  const units: string[] = []
  const unitOfChar: number[] = new Array(chars.length).fill(-1)
  let i = 0
  let unitIdx = 0
  while (i < chars.length) {
    const ch = chars[i]
    if (/\s/u.test(ch)) {
      i += 1
      continue
    }
    if (/[A-Za-z0-9']/u.test(ch)) {
      let j = i
      while (j < chars.length && /[A-Za-z0-9']/u.test(chars[j])) j += 1
      units.push(chars.slice(i, j).join(''))
      for (let k = i; k < j; k++) unitOfChar[k] = unitIdx
      unitIdx += 1
      i = j
    } else {
      units.push(ch)
      unitOfChar[i] = unitIdx
      unitIdx += 1
      i += 1
    }
  }
  return { units, unitOfChar }
}

/**
 * 把一行歌词编码为 token id 序列。
 * 行首加伪词边界 ▁（模拟句首词边界，使行首词可匹配 `▁WORD` 形式 token）。
 * 无法编码的单元整体跳过并记录，聚合时插值。
 */
export function encodeLyricsLine(line: string, mode: AlignVocabMode, vocab: VocabTable): EncodedLine {
  const chars = Array.from(line)
  const { units, unitOfChar } = buildCharUnits(chars)

  // 字节/字符流 + 每字符所属单元（空白 → ▁，unit -1）
  const stream: string[] = []
  const streamUnit: number[] = []
  for (let c = 0; c < chars.length; c++) {
    const ch = chars[c]
    const unit = unitOfChar[c]
    if (/\s/u.test(ch)) {
      stream.push('▁')
      streamUnit.push(-1)
      continue
    }
    if (mode === 'en') {
      stream.push(ch.toUpperCase())
      streamUnit.push(unit)
    } else {
      const bytes = new TextEncoder().encode(ch)
      for (const b of bytes) {
        stream.push(BYTE_TO_CHAR[b])
        streamUnit.push(unit)
      }
    }
  }
  stream.unshift('▁')
  streamUnit.unshift(-1)

  const tokenIds: number[] = []
  const tokenUnits: number[] = []
  const unencodableUnits = new Set<number>()

  let i = 0
  while (i < stream.length) {
    let baseUnit = -1
    for (let k = i; k < stream.length; k++) {
      if (stream[k] !== '▁') {
        baseUnit = streamUnit[k]
        break
      }
    }
    if (baseUnit < 0) break

    let len = 0
    let id = -1
    for (let l = Math.min(vocab.maxLen, stream.length - i); l >= 1; l--) {
      const sub = stream.slice(i, i + l).join('')
      if (!vocab.ids.has(sub)) continue
      let ok = true
      for (let k = i; k < i + l; k++) {
        if (stream[k] !== '▁' && streamUnit[k] !== baseUnit) {
          ok = false
          break
        }
      }
      if (ok) {
        id = vocab.ids.get(sub) as number
        len = l
        break
      }
    }

    if (id < 0 || len <= 0) {
      // 无法编码：标记该单元并整体跳过（含前导词边界）
      unencodableUnits.add(baseUnit)
      let j = i
      while (j < stream.length && (stream[j] === '▁' || streamUnit[j] === baseUnit)) j += 1
      if (j === i) j = i + 1
      i = j
      continue
    }

    // 纯词边界 token（如单独的 ▁）不代表发音单元，不进入 Viterbi 序列
    let boundaryOnly = true
    for (let k = i; k < i + len; k++) {
      if (stream[k] !== '▁') {
        boundaryOnly = false
        break
      }
    }
    if (boundaryOnly) {
      i += len
      continue
    }

    tokenIds.push(id)
    tokenUnits.push(baseUnit)
    i += len
  }

  return {
    line,
    units,
    tokenIds,
    tokenUnits,
    unencodableUnits: Array.from(unencodableUnits).sort((a, b) => a - b),
  }
}

/** 便捷：tokenizeLyricsLine 的单元数量（供行时间窗估算词数） */
export function countLyricsUnits(line: string): number {
  return tokenizeLyricsLine(line).length
}
