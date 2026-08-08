/**
 * 歌词对齐工作区：App 侧把「歌词 + 音素」两个素材落成文件，
 * Agent 通过 run_in_terminal（InstantREPL）读素材、按行追加写 aligned.lrc。
 * 纯逻辑模块，不依赖 UI/Agent 运行时，可用 node --experimental-strip-types 单测。
 */

import { ipaToPinyin } from './phoneme-ipa-mapping.ts'
import type { AlignedPhone } from './phoneme-types.ts'

/** 工作区子目录名（位于终端会话 tmpdir 下） */
export const PHONEME_ALIGN_WORKSPACE_SUBDIR = 'phoneme-align'

/** 工作区文件名 */
export const PHONEME_ALIGN_LYRICS_FILE = 'lyrics.txt'
export const PHONEME_ALIGN_PHONES_FILE = 'phones.tsv'
export const PHONEME_ALIGN_LRC_FILE = 'aligned.lrc'

export type PhonemeWorkspaceFiles = {
  /** lyrics.txt 内容：每行一句歌词（trim 后去空行），保持原样 */
  lyricsText: string
  /** phones.tsv 内容：start\tend\t拼音\tIPA，每行一个音素，跳过空拼音（CTC 标记） */
  phonesTsv: string
}

/** 生成工作区两个素材文件的文本内容 */
export function buildPhonemeWorkspaceFiles(input: {
  lyrics: string
  phoneList: AlignedPhone[]
}): PhonemeWorkspaceFiles {
  const lyricsText = input.lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')

  const rows: string[] = []
  for (const p of input.phoneList) {
    const py = ipaToPinyin(p.symbol)
    if (!py) continue // CTC 特殊标记（<pad> 等），与发给 Agent 的素材口径一致
    rows.push(`${p.start.toFixed(2)}\t${p.end.toFixed(2)}\t${py}\t${p.symbol}`)
  }

  return { lyricsText, phonesTsv: rows.join('\n') }
}

/** 数出文本里已对齐的 LRC 行数（含 `[` 时间戳的行），用于进度显示 */
export function countAlignedLrcLines(text: string): number {
  let count = 0
  for (const line of text.split('\n')) {
    if (line.includes('[')) count += 1
  }
  return count
}

/** 从 Agent 回复里提取 LRC 正文（容忍 markdown 代码块包裹，兼容标准/增强 LRC） */
export function extractLrcFromAnswer(text: string): string {
  const fenced = text.match(/```(?:lrc)?\s*\n([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : text).trim()
  // 保留所有含时间戳的行：[mm:ss.xx]（标准）或 <mm:ss.xx>（增强逐字）
  const lrcLines = body
    .split('\n')
    .filter((line) => line.includes('[') || line.includes('<'))
  if (lrcLines.length === 0) return body
  return lrcLines.join('\n').trim()
}

// ---------------------------------------------------------------------------
// 识别结果旁存：{音频同名}.phones.tsv 放在音频同目录，避免每次测试重新识别
// ---------------------------------------------------------------------------

/** 音频绝对路径 → 旁存文件绝对路径（同目录 + 同名 + .phones.tsv） */
export function phonemeSidecarPath(audioPath: string): string {
  const slash = audioPath.lastIndexOf('/')
  const dir = slash > 0 ? audioPath.slice(0, slash) : '/'
  const name = audioPath.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return `${dir}/${base}.phones.tsv`
}

export type PhonemeSidecarMeta = {
  duration?: number
  sampleRate?: number
  provider?: string
}

/** 旁存文件文本：`# ` 头注释 + 音素 TSV（与工作区 phones.tsv 同列格式） */
export function buildPhonemeSidecarText(input: PhonemeSidecarMeta & { phoneList: AlignedPhone[] }): string {
  const header: string[] = ['# instant-phoneme v1']
  if (input.duration !== undefined) header.push(`# duration=${input.duration}`)
  if (input.sampleRate !== undefined) header.push(`# sampleRate=${input.sampleRate}`)
  if (input.provider) header.push(`# provider=${input.provider}`)
  const body = buildPhonemeWorkspaceFiles({ lyrics: '', phoneList: input.phoneList }).phonesTsv
  return body ? `${header.join('\n')}\n${body}` : header.join('\n')
}

/** 解析旁存文件文本 → 音素列表 + 元数据（坏行跳过） */
export function parsePhonemeSidecarText(text: string): { phones: AlignedPhone[] } & PhonemeSidecarMeta {
  const meta: PhonemeSidecarMeta = {}
  const phones: AlignedPhone[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) {
      const m = trimmed.match(/^#\s*([a-zA-Z]+)=(.*)$/)
      if (!m) continue
      const key = m[1]
      const value = m[2].trim()
      if (key === 'duration') meta.duration = Number(value)
      else if (key === 'sampleRate') meta.sampleRate = Number(value)
      else if (key === 'provider') meta.provider = value
      continue
    }
    const parts = trimmed.split('\t')
    if (parts.length < 4) continue
    const start = Number(parts[0])
    const end = Number(parts[1])
    const symbol = parts[3]
    if (!Number.isFinite(start) || !Number.isFinite(end) || !symbol) continue
    phones.push({ symbol, start, end })
  }
  return { phones, ...meta }
}
