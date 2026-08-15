/**
 * LLM 歌词清洗：剥掉 .lrc 自带但 stripLrcMarkup 洗不掉的非歌词内容
 * （演唱者前缀「徐/刘：」、注释、水印、字幕组标记等）。
 *
 * 核心约束：LLM 只能「删非歌词内容」，不得改写歌词字词、不得合并/新增/删整行——
 * 行数必须与输入严格一致，否则按行序映射的 .lrc 行时间戳会全部错位。
 * 纯提示词/解析可单测；实际 LLM 调用封装在 cleanLyricsWithLlm（计入 AI 用量）。
 */

import { stripLrcMarkup } from '../align/pinyin-g2p.ts'

/** 清洗版本：升级后，对齐入口会对旧版本清洗过的歌词自动重洗 */
export const CLEAN_VERSION = 1

/** 清洗系统提示词：只删非歌词内容，行数必须一致 */
export function buildCleanSystemPrompt(): string {
  return `你是歌词清洗引擎。把用户给出的歌词逐行清洗，只删除「非歌词内容」：

1. 行首的演唱者/角色前缀，如「徐/刘：」「男：」「女：」「对白：」
2. 注释、水印、广告、字幕组标记，如「（演唱：xxx）」「——by xxx」「未经许可不得转载」
3. 不得改写、合并、拆分、删除任何歌词字词；不得新增任何内容
4. 输出行数必须与输入行数严格一致；没有可删内容的行原样保留
5. 只输出清洗后的歌词文本，不要任何解释、Markdown 代码块或额外标记`
}

/** 清洗用户消息：歌词逐行传入（行号前缀帮助模型逐行对照） */
export function buildCleanUserMessage(lyrics: string): string {
  const lines = lyrics.split(/\r?\n/)
  const numbered = lines.map((line, i) => `${i + 1}\t${line}`).join('\n')
  return `待清洗歌词（共 ${lines.length} 行）：
${numbered}`
}

/** 判断 LLM 行相对原行是否「只删了非歌词内容」：去空白后为原行子序列，且长度损失不过半 */
function isSubsequenceAfterTrim(original: string, cleaned: string): boolean {
  const o = original.replace(/\s+/g, '')
  const c = cleaned.replace(/\s+/g, '')
  if (o === c) return true
  if (c.length === 0) return false
  if (c.length < o.length * 0.6) return false
  let oi = 0
  for (let ci = 0; ci < c.length && oi < o.length; ci++) {
    while (oi < o.length && o[oi] !== c[ci]) oi += 1
    if (oi >= o.length) return false
    oi += 1
  }
  return true
}

/**
 * 解析 LLM 返回并校验：
 * - 剥 Markdown 代码块与首尾空白
 * - 行数 ≠ 输入行数 → 返回 null（防行时间戳错位）
 * - 逐行只接受「原行子序列」的删减；LLM 改了词/加了字 → 该行回退原样
 */
export function parseCleanResult(raw: string, originalLines: string[]): string | null {
  let text = raw.trim()
  const fence = text.match(/^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i)
  if (fence) text = fence[1].trim()
  const resultLines = text.split(/\r?\n/)
  if (resultLines.length !== originalLines.length) return null

  const out: string[] = []
  for (let i = 0; i < originalLines.length; i++) {
    const original = originalLines[i].trim()
    const candidate = resultLines[i].trim()
    if (isSubsequenceAfterTrim(original, candidate)) {
      out.push(candidate)
    } else {
      out.push(original)
    }
  }
  return out.join('\n')
}

/** 清洗进度：模型已输出的字数 / 已思考的字数（思考为可选中模型特性） */
export type CleanProgress = {
  written: number
  reasoning: number
}

/**
 * LLM 清洗歌词：成功且行数一致 → 返回清洗结果；任何失败（网络/解析/行数不符）→
 * 回退规则清洗 stripLrcMarkup，不打断流程。usageContext 计入 AI 用量。
 * onProgress 在 stream 期间持续回调（written/reasoning 为累计字数），
 * 供 UI 展示「AI 正在干活」的进度感知。
 */
export async function cleanLyricsWithLlm(
  lyrics: string,
  onProgress?: (progress: CleanProgress) => void,
): Promise<string> {
  const fallback = stripLrcMarkup(lyrics).trim()
  if (!lyrics.trim()) return fallback
  try {
    // 动态 import：streamChatCompletion 依赖链含 .tsx（app-registry），
    // 顶层静态 import 会让纯函数单测在 node 下加载失败
    const { streamChatCompletion } = await import('../../ai/stream-chat.ts')
    let reasoning = 0
    const text = await streamChatCompletion({
      system: buildCleanSystemPrompt(),
      user: buildCleanUserMessage(lyrics),
      usageContext: { actor: 'stems', behavior: 'clean-lyrics', behaviorLabel: '清洗歌词' },
      onChunk: (_delta, accumulated) => {
        onProgress?.({ written: accumulated.length, reasoning })
      },
      onReasoningChunk: (_delta, accumulated) => {
        reasoning = accumulated.length
        onProgress?.({ written: 0, reasoning })
      },
    })
    const parsed = parseCleanResult(text, lyrics.split(/\r?\n/))
    if (parsed === null) {
      console.warn('[lyrics-clean] LLM 清洗结果行数不符，回退规则清洗')
      return fallback
    }
    return parsed.trim() || fallback
  } catch (cause) {
    console.warn('[lyrics-clean] LLM 清洗失败，回退规则清洗', cause)
    return fallback
  }
}
