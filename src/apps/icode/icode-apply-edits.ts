import {
  parseCapabilityRequestBlocks,
  stripCapabilityRequestBlocksFromContent,
  type ICodeCapabilityRequest,
} from './icode-capability-request.ts'

export type ICodeReplaceEdit = {
  search: string
  replace: string
}

export type ApplyReplaceResult =
  | { ok: true; html: string }
  | { ok: false; error: string }

const AIDER_SEARCH_HEAD = '<<<<<<< SEARCH'
const AIDER_DIVIDER = '======='
const AIDER_REPLACE_END = '>>>>>>> REPLACE'
const CAPABILITY_REQUEST_HEAD = '<<<<<<< REQUEST_CAPABILITY'
const CAPABILITY_REQUEST_END = '>>>>>>> END'

function countOccurrences(source: string, search: string): number {
  if (!search) {
    return 0
  }

  let count = 0
  let index = 0
  while ((index = source.indexOf(search, index)) !== -1) {
    count += 1
    index += search.length
  }
  return count
}

function isMarkerLine(line: string, marker: string): boolean {
  return line.trim() === marker
}

function stripOuterCodeFence(content: string): string {
  const trimmed = content.trim()
  const match = trimmed.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```\s*$/i)
  return match?.[1] ?? content
}

export function applyReplaceEdit(source: string, search: string, replace: string): ApplyReplaceResult {
  const count = countOccurrences(source, search)
  if (count === 0) {
    return { ok: false, error: '未找到与 SEARCH 块完全匹配的源码片段' }
  }
  if (count > 1) {
    return {
      ok: false,
      error: `SEARCH 片段在源码中出现 ${count} 次，请加长 SEARCH 以唯一定位`,
    }
  }

  return { ok: true, html: source.replace(search, replace) }
}

export type ApplyEditsResult = {
  html: string
  appliedCount: number
  failedEdits: Array<{ index: number; error: string }>
}

export function applyStreamEdits(source: string, edits: ICodeReplaceEdit[]): ApplyEditsResult {
  let html = source
  const failedEdits: ApplyEditsResult['failedEdits'] = []
  let appliedCount = 0

  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index]
    const result = applyReplaceEdit(html, edit.search, edit.replace)
    if (!result.ok) {
      failedEdits.push({ index, error: result.error })
      continue
    }

    html = result.html
    appliedCount += 1
  }

  return { html, appliedCount, failedEdits }
}

export function parseAiderEditBlocks(content: string): ICodeReplaceEdit[] {
  const normalized = stripOuterCodeFence(content)
  const lines = normalized.split(/\r?\n/)
  const edits: ICodeReplaceEdit[] = []
  let index = 0

  while (index < lines.length) {
    if (!isMarkerLine(lines[index], AIDER_SEARCH_HEAD)) {
      index += 1
      continue
    }

    index += 1
    const searchLines: string[] = []
    while (index < lines.length && !isMarkerLine(lines[index], AIDER_DIVIDER)) {
      searchLines.push(lines[index])
      index += 1
    }
    if (index >= lines.length) {
      break
    }

    index += 1
    const replaceLines: string[] = []
    while (index < lines.length && !isMarkerLine(lines[index], AIDER_REPLACE_END)) {
      replaceLines.push(lines[index])
      index += 1
    }
    if (index >= lines.length) {
      break
    }

    index += 1
    edits.push({
      search: searchLines.join('\n'),
      replace: replaceLines.join('\n'),
    })
  }

  return edits
}

export function createAiderBlockFeed(onBlock: (edit: ICodeReplaceEdit) => void) {
  let buffer = ''
  let appliedBlockCount = 0

  const emitCompleteBlocks = () => {
    const blocks = parseAiderEditBlocks(buffer)
    while (appliedBlockCount < blocks.length) {
      onBlock(blocks[appliedBlockCount])
      appliedBlockCount += 1
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk
      emitCompleteBlocks()
    },
    flush() {
      emitCompleteBlocks()
    },
    getBuffer() {
      return buffer
    },
  }
}

export function addLineNumbers(source: string): string {
  const lines = source.split('\n')
  const width = String(lines.length).length
  return lines.map((line, lineIndex) => `${String(lineIndex + 1).padStart(width, ' ')}|${line}`).join('\n')
}

function stripTrailingIncompleteAiderBlock(content: string): string {
  const markers = ['<<<<<<< SEARCH', '=======', '>>>>>>> REPLACE']
  let cutAt = content.length

  for (const marker of markers) {
    const index = content.indexOf(marker)
    if (index !== -1 && index < cutAt) {
      cutAt = index
    }
  }

  let trimmed = content.slice(0, cutAt)
  trimmed = trimmed.replace(/```(?:html)?\s*$/i, '')
  return trimmed
}

export function stripAiderEditBlocksFromContent(content: string): string {
  let result = stripOuterCodeFence(content)

  const fencedBlockPattern = /```(?:html)?\s*\n?[\s\S]*?<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE[\s\S]*?```/gi
  result = result.replace(fencedBlockPattern, '')

  const blockPattern = /<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/g
  result = result.replace(blockPattern, '')

  result = stripTrailingIncompleteAiderBlock(result)
  result = stripCapabilityRequestBlocksFromContent(result)
  result = stripFullHtmlDocumentsFromText(result)
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

export type ICodeContentSegment =
  | { type: 'text'; text: string }
  | { type: 'edit'; edit: ICodeReplaceEdit; index: number }
  | { type: 'capability_request'; request: ICodeCapabilityRequest; index: number }

const AIDER_BLOCK_PATTERN =
  /(?:```(?:html)?\s*\n?)?<<<<<<< SEARCH[\s\S]*?=======[\s\S]*?>>>>>>> REPLACE(?:\s*\n?```)?/g

const CAPABILITY_REQUEST_BLOCK_PATTERN =
  /(?:```(?:\w+)?\s*\n?)?<<<<<<< REQUEST_CAPABILITY[\s\S]*?=======[\s\S]*?>>>>>>> END(?:\s*\n?```)?/g

function findNextSpecialBlock(
  content: string,
  cursor: number,
): { kind: 'edit' | 'capability'; start: number; end: number; raw: string } | undefined {
  AIDER_BLOCK_PATTERN.lastIndex = cursor
  CAPABILITY_REQUEST_BLOCK_PATTERN.lastIndex = cursor

  const editMatch = AIDER_BLOCK_PATTERN.exec(content)
  const capabilityMatch = CAPABILITY_REQUEST_BLOCK_PATTERN.exec(content)

  if (!editMatch && !capabilityMatch) {
    return undefined
  }

  if (editMatch && capabilityMatch) {
    if (editMatch.index <= capabilityMatch.index) {
      return {
        kind: 'edit',
        start: editMatch.index,
        end: editMatch.index + editMatch[0].length,
        raw: editMatch[0],
      }
    }

    return {
      kind: 'capability',
      start: capabilityMatch.index,
      end: capabilityMatch.index + capabilityMatch[0].length,
      raw: capabilityMatch[0],
    }
  }

  const match = editMatch ?? capabilityMatch
  if (!match) {
    return undefined
  }

  return {
    kind: editMatch ? 'edit' : 'capability',
    start: match.index,
    end: match.index + match[0].length,
    raw: match[0],
  }
}

function stripTrailingIncompleteSpecialBlocks(content: string): string {
  const markers = [
    AIDER_SEARCH_HEAD,
    AIDER_DIVIDER,
    AIDER_REPLACE_END,
    CAPABILITY_REQUEST_HEAD,
    CAPABILITY_REQUEST_END,
  ]
  let cutAt = content.length

  for (const marker of markers) {
    const index = content.indexOf(marker)
    if (index !== -1 && index < cutAt) {
      cutAt = index
    }
  }

  let trimmed = content.slice(0, cutAt)
  trimmed = trimmed.replace(/```(?:html)?\s*$/i, '')
  return trimmed
}

export function parseIcodeContentSegments(content: string): ICodeContentSegment[] {
  const normalized = content.replace(/\r\n/g, '\n')
  const segments: ICodeContentSegment[] = []
  let editIndex = 0
  let capabilityIndex = 0
  let cursor = 0

  while (cursor < normalized.length) {
    const nextBlock = findNextSpecialBlock(normalized, cursor)
    if (!nextBlock) {
      break
    }

    const before = normalized
      .slice(cursor, nextBlock.start)
      .replace(/```(?:html)?\s*$/i, '')
      .trim()
    if (before) {
      segments.push({ type: 'text', text: before })
    }

    if (nextBlock.kind === 'edit') {
      const parsed = parseAiderEditBlocks(nextBlock.raw)
      if (parsed[0]) {
        segments.push({ type: 'edit', edit: parsed[0], index: editIndex })
        editIndex += 1
      }
    } else {
      const parsed = parseCapabilityRequestBlocks(nextBlock.raw)
      if (parsed[0]) {
        segments.push({ type: 'capability_request', request: parsed[0], index: capabilityIndex })
        capabilityIndex += 1
      }
    }

    cursor = nextBlock.end
  }

  const tail = stripTrailingIncompleteSpecialBlocks(normalized.slice(cursor))
    .replace(/^```(?:html)?\s*/i, '')
    .trim()
  if (tail) {
    segments.push({ type: 'text', text: tail })
  }

  if (segments.length === 0) {
    const plain = stripAiderEditBlocksFromContent(content)
    if (plain) {
      segments.push({ type: 'text', text: plain })
    }
  }

  return segments
}

function lastEditSegmentIndex(segments: ICodeContentSegment[]): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.type === 'edit') {
      return index
    }
  }
  return -1
}

export function extractFinalReplyAfterEdits(content: string): string {
  const segments = parseIcodeContentSegments(content)
  const lastEditIndex = lastEditSegmentIndex(segments)

  if (lastEditIndex === -1) {
    return segments
      .filter((segment): segment is { type: 'text'; text: string } => segment.type === 'text')
      .map((segment) => segment.text)
      .join('\n\n')
      .trim()
  }

  return segments
    .slice(lastEditIndex + 1)
    .filter((segment): segment is { type: 'text'; text: string } => segment.type === 'text')
    .map((segment) => segment.text)
    .join('\n\n')
    .trim()
}

export function extractLeadingReplyBeforeEdits(content: string): string {
  const segments = parseIcodeContentSegments(content)
  const firstEditIndex = segments.findIndex((segment) => segment.type === 'edit')
  if (firstEditIndex <= 0) {
    return ''
  }

  return segments
    .slice(0, firstEditIndex)
    .filter((segment): segment is { type: 'text'; text: string } => segment.type === 'text')
    .map((segment) => segment.text)
    .join('\n\n')
    .trim()
}

export function isAiderEditInProgress(content: string): boolean {
  if (!content.includes(AIDER_SEARCH_HEAD)) {
    return false
  }

  const markerCount = (content.match(/<<<<<<< SEARCH/g) ?? []).length
  return markerCount > parseAiderEditBlocks(content).length
}

function looksLikeStreamingCode(text: string): boolean {
  const trimmed = text.trimStart()
  return (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<') ||
    trimmed.startsWith('```') ||
    trimmed.includes(AIDER_SEARCH_HEAD)
  )
}

/** 提取 AI 输出中尚未完成的代码片段（用于对话区底部实时展示）。 */
export function extractInProgressCodeOutput(content: string): string {
  if (!content.trim()) {
    return ''
  }

  const normalized = content.replace(/\r\n/g, '\n')
  const completeBlockPattern =
    /(?:```(?:html)?\s*\n?)?<<<<<<< SEARCH[\s\S]*?=======[\s\S]*?>>>>>>> REPLACE(?:\s*\n?```)?/g
  let lastCompleteEnd = 0
  let match: RegExpExecArray | null = null

  completeBlockPattern.lastIndex = 0
  while ((match = completeBlockPattern.exec(normalized)) !== null) {
    lastCompleteEnd = match.index + match[0].length
  }

  let tail = normalized.slice(lastCompleteEnd).replace(/^\s+/, '')
  tail = tail.replace(/^```(?:html)?\s*\n?/i, '')

  if (isAiderEditInProgress(normalized) || tail.includes(AIDER_SEARCH_HEAD) || tail.includes(AIDER_DIVIDER)) {
    return tail.trimEnd()
  }

  if (!tail) {
    return looksLikeStreamingCode(normalized) ? normalized.trimEnd() : ''
  }

  const leadingReply = extractLeadingReplyBeforeEdits(normalized)
  if (leadingReply && !looksLikeStreamingCode(tail)) {
    return ''
  }

  if (looksLikeStreamingCode(tail)) {
    return tail.trimEnd()
  }

  return ''
}

const FULL_HTML_FENCED_PATTERN = /```(?:html)?\s*\n([\s\S]*?<\/html>)\s*\n```/gi
const FULL_HTML_BARE_PATTERN = /<!DOCTYPE[\s\S]*?<\/html>/gi

export function looksLikeFullHtmlDocument(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }

  return (
    trimmed.startsWith('<!DOCTYPE') ||
    /^<html[\s>]/i.test(trimmed) ||
    /```(?:html)?[\s\S]*<!DOCTYPE/i.test(trimmed)
  )
}

export function extractCompleteFullHtmlDocuments(content: string): string[] {
  const docs: string[] = []
  const seen = new Set<string>()

  for (const match of content.matchAll(FULL_HTML_FENCED_PATTERN)) {
    const doc = match[1]?.trim()
    if (doc && !seen.has(doc)) {
      seen.add(doc)
      docs.push(doc)
    }
  }

  FULL_HTML_BARE_PATTERN.lastIndex = 0
  for (const match of content.matchAll(FULL_HTML_BARE_PATTERN)) {
    const doc = match[0]?.trim()
    if (doc && !seen.has(doc)) {
      seen.add(doc)
      docs.push(doc)
    }
  }

  return docs
}

export function stripFullHtmlDocumentsFromText(text: string): string {
  let result = text
  result = result.replace(/```(?:html)?\s*\n[\s\S]*?<\/html>\s*\n```/gi, '')
  result = result.replace(/<!DOCTYPE[\s\S]*?<\/html>/gi, '')
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

export function extractFullHtmlDocumentFromContent(content: string): string | undefined {
  const docs = extractCompleteFullHtmlDocuments(content)
  return docs[docs.length - 1]
}

function stripCompletedHtmlForTailScan(content: string): string {
  let result = stripCapabilityRequestBlocksFromContent(stripAiderEditBlocksFromContent(content))
  result = result.replace(/```(?:html)?\s*\n[\s\S]*?<\/html>\s*\n```/gi, '')
  result = result.replace(/<!DOCTYPE[\s\S]*?<\/html>/gi, '')
  return result
}

function extractTrailingIncompleteHtml(text: string): string | undefined {
  const fenceIndex = text.lastIndexOf('```html')
  const doctypeIndex = text.lastIndexOf('<!DOCTYPE')
  const htmlIndex = text.lastIndexOf('<html')
  const startIndex = Math.max(fenceIndex, doctypeIndex, htmlIndex)

  if (startIndex === -1) {
    return undefined
  }

  let chunk = text.slice(startIndex)
  chunk = chunk.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n```\s*$/i, '')

  if (chunk.includes('</html>')) {
    return undefined
  }

  return chunk.trimEnd() || undefined
}

/** 定位正文中首次出现的 HTML 流式输出标记（围栏、DOCTYPE、html 根元素）。 */
function findFirstHtmlArtifactStart(text: string): number | undefined {
  let first: number | undefined

  for (const pattern of [/```(?:html)?/i, /<!DOCTYPE/i, /<html[\s>]/i]) {
    const match = pattern.exec(text)
    if (match?.index !== undefined && (first === undefined || match.index < first)) {
      first = match.index
    }
  }

  return first
}

function findProseCutoffForInProgressHtml(text: string): number | undefined {
  if (extractTrailingIncompleteHtml(text)) {
    return findFirstHtmlArtifactStart(text)
  }

  const fenceMatch = text.match(/```(?:html)?\s*$/i)
  return fenceMatch?.index
}

/** 从正文中移除进行中的 HTML 输出（围栏、DOCTYPE 及后续未写完的源码）。 */
export function stripInProgressHtmlFromProse(text: string): string {
  const cutoff = findProseCutoffForInProgressHtml(text)
  if (cutoff === undefined) {
    return stripFullHtmlDocumentsFromText(text)
  }

  if (cutoff <= 0) {
    return ''
  }

  return stripFullHtmlDocumentsFromText(text.slice(0, cutoff)).trim()
}

export function extractInProgressFullHtmlOutput(content: string): string {
  if (!content.trim()) {
    return ''
  }

  const withoutBlocks = stripCompletedHtmlForTailScan(content)
  const trailing = extractTrailingIncompleteHtml(withoutBlocks)
  if (trailing) {
    return trailing
  }

  let tail = withoutBlocks.trim()
  tail = tail.replace(/^```(?:html)?\s*\n?/i, '')

  if (!tail) {
    return ''
  }

  if (
    tail.startsWith('<!DOCTYPE') ||
    tail.startsWith('<html') ||
    (tail.startsWith('<') && !tail.startsWith('<<<<<<<'))
  ) {
    return tail.trimEnd()
  }

  return ''
}

export type ICodeTextDisplayPart =
  | { type: 'prose'; text: string }
  | { type: 'full_html'; html: string; complete: boolean }

export function splitTextForDisplay(text: string): ICodeTextDisplayPart[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  const parts: ICodeTextDisplayPart[] = []
  const incomplete = extractTrailingIncompleteHtml(trimmed)
  const prose = stripInProgressHtmlFromProse(trimmed)

  if (prose) {
    parts.push({ type: 'prose', text: prose })
  }

  for (const html of extractCompleteFullHtmlDocuments(trimmed)) {
    parts.push({ type: 'full_html', html, complete: true })
  }

  if (
    incomplete &&
    !parts.some((part) => part.type === 'full_html' && part.html === incomplete)
  ) {
    parts.push({ type: 'full_html', html: incomplete, complete: false })
  }

  if (parts.length === 0 && looksLikeFullHtmlDocument(trimmed)) {
    parts.push({
      type: 'full_html',
      html: trimmed.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n```\s*$/i, '').trim(),
      complete: /<\/html>\s*$/i.test(trimmed),
    })
  }

  return parts
}

export function countTextLines(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) {
    return 0
  }

  return trimmed.split('\n').length
}

/** 按 AI 输出顺序拼接全部自然语言段落（去掉 SEARCH/REPLACE 块与完整 HTML）。 */
export function extractNaturalLanguageReply(content: string): string {
  const segments = parseIcodeContentSegments(content)
  const texts = segments
    .filter((segment): segment is { type: 'text'; text: string } => segment.type === 'text')
    .map((segment) => stripInProgressHtmlFromProse(segment.text.trim()))
    .filter(Boolean)

  if (texts.length > 0) {
    return texts.join('\n\n').trim()
  }

  return stripInProgressHtmlFromProse(stripAiderEditBlocksFromContent(content)).trim()
}

export function pickLastReplyParagraph(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return ''
  }

  const paragraphs = trimmed.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  return paragraphs[paragraphs.length - 1] ?? trimmed
}

export function hasMultipleReplyParagraphs(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }

  return trimmed.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).length > 1
}
