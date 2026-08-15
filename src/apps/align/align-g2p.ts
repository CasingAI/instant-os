/**
 * LLM G2P：歌词 → 逐字/词 IPA 音素序列。
 * 纯解析/提示词逻辑可单测；实际 LLM 调用已在歌词对齐 App 移除时一并删除。
 */

import type { G2pLine, G2pUnit } from './align-types.ts'

/**
 * 西里尔视觉同形字符 → 拉丁（网上英文歌词常见混入，如 `thе internet` 里的 е 是 U+0435）。
 * 不映射 `ё`（发音 yo，非视觉同形）、`й` 等非同形字符。作用于目标字符，不碰中文/数字/标点。
 */
const CYRILLIC_CONFUSABLES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', с: 'c', р: 'p', у: 'y',
  х: 'x', к: 'k', м: 'm', т: 't', в: 'b', н: 'h', і: 'i',
}

export function normalizeConfusables(text: string): string {
  return Array.from(text).map((c) => CYRILLIC_CONFUSABLES[c] ?? c).join('')
}

/** 分词：CJK 一字一单元；拉丁字母串成词；其余标点/符号各一单元 */
export function tokenizeLyricsLine(line: string): string[] {
  const units: string[] = []
  const chars = Array.from(line)
  let i = 0
  while (i < chars.length) {
    const ch = chars[i]
    if (/\s/u.test(ch)) {
      i += 1
      continue
    }
    // 拉丁/数字词
    if (/[A-Za-z0-9']/u.test(ch)) {
      let word = ch
      i += 1
      while (i < chars.length && /[A-Za-z0-9']/u.test(chars[i])) {
        word += chars[i]
        i += 1
      }
      units.push(word)
      continue
    }
    // 其余（汉字、假名、谚文、标点）各一
    units.push(ch)
    i += 1
  }
  return units
}

/** 歌词全文 → 按行分词后的期望单元骨架（phones 为空，待 LLM 填充）。
 * 入口做西里尔视觉同形字符归一化：`thе`→`the`、`prefеr`→`prefer`，
 * 让混入伪字符的歌词在分词后是正确拼写（显示与匹配同步修正）。 */
export function buildLyricsSkeleton(lyrics: string): G2pLine[] {
  return lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => {
      const clean = normalizeConfusables(text)
      return {
        text: clean,
        units: tokenizeLyricsLine(clean).map((t) => ({ text: t, phones: [] as string[] })),
      }
    })
}

/** 从 vocab 里抽一批常用 IPA 符号作提示（跳过 CTC 特殊标记） */
export function pickVocabHint(vocabSymbols: string[], limit = 120): string {
  const special = new Set(['<pad>', '<s>', '</s>', '<unk>', '??'])
  const picked: string[] = []
  for (const s of vocabSymbols) {
    if (special.has(s)) continue
    picked.push(s)
    if (picked.length >= limit) break
  }
  return picked.join(' ')
}

/** G2P 系统提示词 */
export function buildG2pSystemPrompt(vocabHint: string): string {
  return `你是歌词转音素（G2P）引擎。把用户给出的歌词逐字/逐词转成 IPA 音素序列，供后续强制对齐使用。

规则：
1. 按行处理；每行拆成单元：汉字/假名/谚文一字一单元；英文等拉丁文字一个单词一单元；标点单独一单元且 phones 为空数组
2. 每个有声单元的 phones 使用国际音标（IPA），尽量选用下列模型词表中的符号（空格分隔）：
${vocabHint}
3. 不要改写歌词文字；单元 text 必须与原文逐字/词一致
4. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。格式：
{"lines":[{"text":"行原文","units":[{"text":"字或词","phones":["ipa",...]},...]},...]}
5. lines 数量与输入非空行数一致；每行 units 拼接（忽略空白）后等于该行原文`
}

/** G2P 用户消息 */
export function buildG2pUserMessage(lyrics: string): string {
  const lines = lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return `请转换以下 ${lines.length} 行歌词：\n\n${lines.join('\n')}`
}

export type ParseG2pError = {
  message: string
}

/**
 * 解析并校验 LLM 返回的 G2P JSON。
 * 成功返回按行的 G2pLine[]；失败抛错（中文信息）。
 */
export function parseG2pResult(raw: string, lyrics: string): G2pLine[] {
  const skeleton = buildLyricsSkeleton(lyrics)
  if (skeleton.length === 0) {
    throw new Error('没有可转换的歌词行')
  }

  const jsonText = extractJsonObject(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('G2P 返回不是合法 JSON')
  }

  if (!parsed || typeof parsed !== 'object' || !('lines' in parsed)) {
    throw new Error('G2P 返回缺少 lines 字段')
  }
  const linesRaw = (parsed as { lines: unknown }).lines
  if (!Array.isArray(linesRaw)) {
    throw new Error('G2P 的 lines 不是数组')
  }
  if (linesRaw.length !== skeleton.length) {
    throw new Error(
      `G2P 行数不匹配：期望 ${skeleton.length} 行，得到 ${linesRaw.length} 行`,
    )
  }

  const result: G2pLine[] = []
  for (let i = 0; i < skeleton.length; i++) {
    const expected = skeleton[i]
    const item = linesRaw[i]
    if (!item || typeof item !== 'object') {
      throw new Error(`G2P 第 ${i + 1} 行格式错误`)
    }
    const unitsRaw = (item as { units?: unknown }).units
    if (!Array.isArray(unitsRaw)) {
      throw new Error(`G2P 第 ${i + 1} 行缺少 units`)
    }

    const units: G2pUnit[] = []
    for (const u of unitsRaw) {
      if (!u || typeof u !== 'object') continue
      const text = typeof (u as { text?: unknown }).text === 'string'
        ? (u as { text: string }).text
        : ''
      if (!text) continue
      const phonesRaw = (u as { phones?: unknown }).phones
      const phones = Array.isArray(phonesRaw)
        ? phonesRaw.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : []
      units.push({ text, phones })
    }

    // 校验：单元拼接 ≈ 行原文（去空白）
    const joined = units.map((u) => u.text).join('')
    const expectedJoined = expected.units.map((u) => u.text).join('')
    if (joined !== expectedJoined) {
      // 宽松：若单元数与骨架一致则按骨架文字强制纠正（保留 phones）
      if (units.length === expected.units.length) {
        for (let k = 0; k < units.length; k++) {
          units[k] = { text: expected.units[k].text, phones: units[k].phones }
        }
      } else {
        throw new Error(
          `G2P 第 ${i + 1} 行文字不一致：期望「${expectedJoined}」，得到「${joined}」`,
        )
      }
    }

    result.push({ text: expected.text, units })
  }
  return result
}

/** 从回复里抽出 JSON 对象（容忍 markdown 代码块包裹） */
function extractJsonObject(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : trimmed).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('G2P 返回中找不到 JSON 对象')
  }
  return body.slice(start, end + 1)
}

/** 把按行 G2P 结果展平成单元序列（供 DTW） */
export function flattenG2pLines(lines: G2pLine[]): G2pUnit[] {
  const units: G2pUnit[] = []
  for (const line of lines) {
    units.push(...line.units)
  }
  return units
}
