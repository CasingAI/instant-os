/**
 * LLM G2P：歌词 → 逐字/逐词音素序列（纯逻辑，可单测）。
 *
 * 让 LLM 把任意语言歌词转成「每行 → 单元数组（字/词 + 音素符号序列）」。
 * 用 LLM 做转换天然语言无关（中英日韩等通吃），无需为每种语言维护查表。
 * 音素符号尽量贴合音频侧 wav2vec2 的 vocab（`public/assets/phoneme/vocab.json`），
 * 以降低 DTW 符号失配；不强制唯一，DTW 的插入/删除容忍兜底。
 */

import type { G2pLine, G2pUnit } from './align-types.ts'

/** 常用音素符号提示子集（与模型 vocab 高频项对齐，供 LLM 参考输出）。 */
export const G2P_VOCAB_HINT = [
  // 声母 / 辅音
  'p', 'ph', 'b', 'm', 'f', 'v', 't', 'th', 'd', 'n', 'l', 'k', 'kh', 'g', 'h', 'x',
  'ts', 'tsh', 'dz', 's', 'z', 'tɕ', 'tɕh', 'dʑ', 'ɕ', 'ʑ', 'ʈ', 'ʈh', 'ʂ', 'ʐ',
  'tʃ', 'tʃh', 'dʒ', 'ʃ', 'ʒ', 'ŋ', 'ɲ', 'j', 'w', 'r', 'ɹ', 'ʋ', 'ð', 'θ',
  // 韵母 / 元音
  'a', 'ɑ', 'e', 'ə', 'i', 'o', 'u', 'y', 'ɛ', 'ɪ', 'ʊ', 'ɔ', 'ɐ', 'æ', 'ɜ', 'œ', 'ø',
  'ai', 'ei', 'ao', 'ou', 'ia', 'ie', 'iao', 'iou', 'ua', 'uo', 'uai', 'uei', 'üe',
  'an', 'en', 'in', 'un', 'ün', 'ang', 'eng', 'ing', 'ong', 'ian', 'iang', 'uang', 'iong',
  'i5', 'i2', 'i1', 'i4', 'a5', 'a1', 'a2', 'a4',
] as const

export type G2pParseIssue = {
  /** 原始行下标 */
  lineIndex: number
  /** 期望拼接文本（去空白） */
  expected: string
  /** 实际拼接文本（去空白） */
  actual: string
}

export class G2pParseError extends Error {
  issues: G2pParseIssue[]

  constructor(message: string, issues: G2pParseIssue[] = []) {
    super(message)
    this.name = 'G2pParseError'
    this.issues = issues
  }
}

/** 系统提示词：G2P 任务说明与输出格式 */
export function buildG2pSystemPrompt(): string {
  return `你是歌词音素标注引擎。把用户给出的歌词逐行转换成「逐字/逐词 + 音素序列」的 JSON。

任务：
- 把每行歌词切分成单元：中文/日文/韩文按「字」（汉字/假名/谚文），英文等空格分词语言按「词」。
- 每个单元给出它的音素符号序列（IPA 风格），按实际发音顺序。
- 标点（，。！？、；：,.!?;: 及括号引号等）并入前一个单元文本末尾，不单独成单元；行首标点并入后一单元。
- 英文词间空格不输出（由渲染层补）。
- 歌词原文逐字保留，绝不改写、不纠错、不增删。

音素符号要求：
- 优先使用以下常用符号（与音频识别模型一致，减小对齐失配）：
  ${G2P_VOCAB_HINT.join(' ')}
- 音素用空格或直接连排皆可；每个单元用字符串数组给出，如 ["n","i"]。
- 多音字按演唱语境选最可能的读音；不确定时给最常见读音。
- 若某单元实在无法给出音素（如纯符号行），phones 给空数组 []。

输出格式（严格 JSON，不要任何多余文字，不要 markdown 代码块）：
[
  { "units": [
      { "text": "你", "phones": ["n","i"] },
      { "text": "好", "phones": ["x","ɑu"] }
  ] },
  { "units": [ ... 第 2 行 ... ] }
]
- 数组长度 = 歌词行数，每行一个对象，顺序与歌词行一致。
- 每行 units 内所有 text 按顺序拼接（去掉标点空格差异）必须还原该行歌词原文。
`
}

/** 构建 G2P 用户消息：歌词原文 */
export function buildG2pUserMessage(lyricsLines: string[]): string {
  return lyricsLines.map((line, index) => `第 ${index + 1} 行：${line}`).join('\n')
}

/** 从 LLM 回复中提取 JSON 正文（容忍 ```json code fence / 前后说明文字） */
export function extractJsonFromAnswer(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, '')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析并校验 G2P 结果。
 * 结构：每行一个对象 { units: [{ text, phones }] }，数组长度 = 行数。
 * 校验：行数匹配；每行 text 拼接（去空白）与歌词原文一致；phones 为字符串数组。
 * 失败抛 G2pParseError，携带逐行不一致清单。
 */
export function parseG2pResult(text: string, originalLines: string[]): G2pLine[] {
  const body = extractJsonFromAnswer(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new G2pParseError('G2P 返回内容不是合法 JSON，请重试')
  }
  if (!Array.isArray(parsed)) {
    throw new G2pParseError('G2P 返回不是数组，请重试')
  }
  if (parsed.length !== originalLines.length) {
    throw new G2pParseError(
      `G2P 行数不匹配：期望 ${originalLines.length} 行，实际 ${parsed.length} 行`,
    )
  }

  const issues: G2pParseIssue[] = []
  const result: G2pLine[] = []

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i]
    if (!isPlainObject(row) || !Array.isArray(row.units)) {
      throw new G2pParseError(`第 ${i + 1} 行不是 { units: [...] } 结构`)
    }
    const units: G2pUnit[] = []
    let joined = ''
    for (const rawUnit of row.units) {
      if (!isPlainObject(rawUnit)) {
        throw new G2pParseError(`第 ${i + 1} 行存在非法单元`)
      }
      const text = typeof rawUnit.text === 'string' ? rawUnit.text : ''
      const phonesRaw = rawUnit.phones
      const phones = Array.isArray(phonesRaw)
        ? phonesRaw.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : []
      units.push({ text, phones })
      joined += text
    }
    const expected = normalizeForCompare(originalLines[i])
    const actual = normalizeForCompare(joined)
    if (expected !== actual) {
      issues.push({ lineIndex: i, expected, actual })
    }
    result.push(units)
  }

  if (issues.length > 0) {
    throw new G2pParseError(
      `${issues.length} 行歌词与原文不一致（G2P 改写/漏字了）`,
      issues,
    )
  }

  return result
}
