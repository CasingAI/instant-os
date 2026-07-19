/**
 * 语音对话脚本：解析 <speak> / <sing> / <ignore/>。
 * - speak：普通朗读
 * - sing：唱歌；song/style 属性 + 正文歌词
 */

import { MIMO_TTS_VOICES } from '../../ai/speech-mimo-adapter.ts'

export const SPEECH_IGNORE_TAG = '<ignore/>'

/** 缺省 speak 风格（对齐官网自然语言 style 示例，英文） */
export const DEFAULT_SPEAK_STYLE =
  'Natural conversational tone, clear and friendly.'

/** 缺省 sing 风格 */
export const DEFAULT_SING_STYLE =
  'Sing the melody clearly with natural phrasing and steady pitch.'

export type SpeechScriptLine = {
  kind: 'speak' | 'sing'
  voice: string
  /** 台词或歌词（不含外层 XML） */
  text: string
  /**
   * TTS 风格指令（必填；→ MiMo user message）。
   * 官方示例多为英文自然语言；中英均可。
   * sing 时会与 song 拼成最终 style。
   */
  style: string
  /** 可选角色名，仅展示 */
  name?: string
  /** 歌名（仅 sing） */
  song?: string
}

export type ParsedSpeechReply =
  | { kind: 'ignore' }
  | { kind: 'speech'; lines: SpeechScriptLine[]; displayText: string }

const IGNORE_TAG_RE = /<\s*ignore\s*\/?\s*>/gi
const BLOCK_RE = /<(speak|sing)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const LEGACY_SING_PREFIX_RE = /^\s*[（(]\s*(唱歌|sing|singing)\s*[)）]\s*/i

const KNOWN_VOICES = new Set(MIMO_TTS_VOICES.map((item) => item.id))

function getAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i')
  const match = attrs.match(re)
  const value = match?.[1]?.trim()
  return value || undefined
}

/** 去掉 XML 尖括号标签 */
function stripXmlTags(text: string): string {
  return text.replace(/<\/?[^>]+>/g, '').trim()
}

function resolveVoice(raw: string | undefined, fallback: string): string {
  const voice = raw?.trim()
  if (voice && KNOWN_VOICES.has(voice)) {
    return voice
  }
  return fallback
}

function normalizeSongTitle(raw: string | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  return value.replace(/^[《「"']+|[》」"']+$/g, '').trim() || undefined
}

export function isSingingSpeechLine(line: SpeechScriptLine): boolean {
  return line.kind === 'sing'
}

/** 气泡展示用正文 */
export function speechLineDisplayText(line: SpeechScriptLine): string {
  return line.text.replace(LEGACY_SING_PREFIX_RE, '').trim() || line.text
}

/** 送给 MiMo TTS 的正文 */
export function buildTtsText(line: SpeechScriptLine): string {
  const body = speechLineDisplayText(line)
  if (line.kind === 'sing') {
    return `(唱歌)${body}`
  }
  return body
}

/** 送给 MiMo TTS 的风格指令（user message，始终有值） */
export function buildTtsStyle(line: SpeechScriptLine): string {
  const style = line.style.trim() || (
    line.kind === 'sing' ? DEFAULT_SING_STYLE : DEFAULT_SPEAK_STYLE
  )
  if (line.kind === 'sing') {
    const song = normalizeSongTitle(line.song)
    if (song) return `Sing the song "${song}". ${style}`
  }
  return style
}

export function formatSpeechLinesForDisplay(lines: readonly SpeechScriptLine[]): string {
  return lines
    .map((line) => {
      const base = line.name?.trim()
        ? `${line.name.trim()} · ${line.voice}`
        : line.voice
      if (line.kind === 'sing') {
        const song = normalizeSongTitle(line.song)
        const label = song ? `${base} · 唱《${song}》` : `${base} · 唱`
        return `【${label}】${speechLineDisplayText(line)}`
      }
      return `【${base}】${speechLineDisplayText(line)}`
    })
    .join('\n')
}

export function isSpeechIgnoreReply(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }
  const withoutIgnore = trimmed.replace(IGNORE_TAG_RE, '').trim()
  return IGNORE_TAG_RE.test(trimmed) && stripXmlTags(withoutIgnore).length === 0
}

export function stripSpeechControlMarkup(text: string): string {
  return text
    .replace(IGNORE_TAG_RE, '')
    .replace(/<\/?(?:speak|sing)\b[^>]*>/gi, '')
    .trim()
}

export function formatStreamingSpeechView(
  accumulated: string,
  defaultVoice: string,
): { lines: SpeechScriptLine[]; draft?: string; displayText: string } {
  if (isSpeechIgnoreReply(accumulated)) {
    return { lines: [], displayText: '' }
  }

  const lines = extractClosedSpeakLines(accumulated, defaultVoice)
  const draft = extractUnclosedScriptDraft(accumulated)
  const parts: string[] = []
  if (lines.length > 0) {
    parts.push(formatSpeechLinesForDisplay(lines))
  }
  if (draft) {
    parts.push(draft)
  }
  return {
    lines,
    draft: draft || undefined,
    displayText: parts.join('\n'),
  }
}

function extractUnclosedScriptDraft(raw: string): string {
  const withoutClosed = raw
    .replace(IGNORE_TAG_RE, '')
    .replace(/<(speak|sing)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  const open = withoutClosed.match(/<(speak|sing)\b([^>]*)>([\s\S]*)$/i)
  if (open) {
    return stripXmlTags(open[3] ?? '').trim()
  }
  return stripXmlTags(withoutClosed).trim()
}

export function parseSpeechReply(
  raw: string,
  defaultVoice: string,
): ParsedSpeechReply {
  const trimmed = raw.trim()
  if (!trimmed || isSpeechIgnoreReply(trimmed)) {
    return { kind: 'ignore' }
  }

  const lines = extractSpeakLines(trimmed, defaultVoice, true)
  if (lines.length === 0) {
    return { kind: 'ignore' }
  }

  return {
    kind: 'speech',
    lines,
    displayText: formatSpeechLinesForDisplay(lines),
  }
}

export function extractClosedSpeakLines(
  accumulated: string,
  defaultVoice: string,
): SpeechScriptLine[] {
  return extractSpeakLines(accumulated, defaultVoice, false)
}

function resolveStyle(
  raw: string | undefined,
  kind: 'speak' | 'sing',
): string {
  const style = raw?.trim()
  if (style) return style
  return kind === 'sing' ? DEFAULT_SING_STYLE : DEFAULT_SPEAK_STYLE
}

function parseBlock(
  tag: string,
  attrs: string,
  inner: string,
  defaultVoice: string,
): SpeechScriptLine | undefined {
  const voice = resolveVoice(getAttr(attrs, 'voice'), defaultVoice)
  const name = getAttr(attrs, 'name')
  const text = stripXmlTags(inner)
  if (!text) return undefined

  if (tag.toLowerCase() === 'sing') {
    return {
      kind: 'sing',
      voice,
      text: text.replace(LEGACY_SING_PREFIX_RE, '').trim() || text,
      style: resolveStyle(getAttr(attrs, 'style'), 'sing'),
      name,
      song: normalizeSongTitle(getAttr(attrs, 'song')),
    }
  }

  return {
    kind: 'speak',
    voice,
    text,
    style: resolveStyle(getAttr(attrs, 'style'), 'speak'),
    name,
  }
}

function extractSpeakLines(
  raw: string,
  defaultVoice: string,
  includeTrailingPlain: boolean,
): SpeechScriptLine[] {
  const lines: SpeechScriptLine[] = []
  let lastIndex = 0
  const re = new RegExp(BLOCK_RE.source, 'gi')
  let match: RegExpExecArray | undefined
  while ((match = re.exec(raw) ?? undefined)) {
    if (includeTrailingPlain) {
      const before = stripXmlTags(
        raw.slice(lastIndex, match.index).replace(IGNORE_TAG_RE, ''),
      )
      if (before) {
        lines.push({
          kind: 'speak',
          voice: defaultVoice,
          text: before,
          style: DEFAULT_SPEAK_STYLE,
        })
      }
    }

    const line = parseBlock(
      match[1] ?? 'speak',
      match[2] ?? '',
      match[3] ?? '',
      defaultVoice,
    )
    if (line) {
      lines.push(line)
    }
    lastIndex = re.lastIndex
  }

  if (includeTrailingPlain) {
    const after = stripXmlTags(raw.slice(lastIndex).replace(IGNORE_TAG_RE, ''))
    if (after) {
      lines.push({
        kind: 'speak',
        voice: defaultVoice,
        text: after,
        style: DEFAULT_SPEAK_STYLE,
      })
    }
  }

  return lines
}

/** 写入 system prompt 的音色清单 */
export function speechVoicePromptList(): string {
  return MIMO_TTS_VOICES.map((item) => `- ${item.id}（${item.label}）`).join('\n')
}
