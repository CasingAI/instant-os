import {
  extractPartialHtmlFromStream,
  stabilizePartialHtml,
} from '../browser/extract-partial-html.ts'

const THINKING_BLOCK_RE =
  /<!--\s*SCENE3D_THINKING\s*-->[\s\S]*?<!--\s*\/SCENE3D_THINKING\s*-->/gi

const HTML_FENCE_RE = /```(?:html)?\s*([\s\S]*?)```/gi

function findHtmlDocumentStart(text: string): number {
  const doctype = text.search(/<!DOCTYPE\s+html/i)
  if (doctype >= 0) {
    return doctype
  }

  return text.search(/<html[\s>]/i)
}

export function stripScene3dThinkingBlock(text: string): string {
  return text.replace(THINKING_BLOCK_RE, '').trim()
}

function isScene3dThinkingOnly(content: string): boolean {
  const trimmed = content.trim()
  if (!/SCENE3D_THINKING/i.test(trimmed)) {
    return false
  }

  return findHtmlDocumentStart(trimmed) < 0
}

function sliceFromDocument(content: string): string {
  const docStart = findHtmlDocumentStart(content)
  if (docStart >= 0) {
    return content.slice(docStart).trim()
  }

  return content.trim()
}

function extractBestCompleteFencedHtml(text: string): string | undefined {
  let fallback: string | undefined

  for (const match of text.matchAll(HTML_FENCE_RE)) {
    const content = match[1]?.trim() ?? ''
    if (!content || isScene3dThinkingOnly(content)) {
      continue
    }

    if (findHtmlDocumentStart(content) >= 0) {
      return sliceFromDocument(content)
    }

    if (!fallback) {
      fallback = content
    }
  }

  return fallback
}

function extractOpenFencedHtml(text: string): string | undefined {
  const openFence = text.match(/```(?:html)?\s*([\s\S]*)$/i)
  const candidate = openFence?.[1]?.replace(/\n?```[\s\S]*$/, '').trim() ?? ''
  if (!candidate || isScene3dThinkingOnly(candidate)) {
    return undefined
  }

  const docStart = findHtmlDocumentStart(candidate)
  if (docStart >= 0) {
    return candidate.slice(docStart)
  }

  return candidate.startsWith('<') ? candidate : undefined
}

function extractLooseHtmlDocument(text: string): string | undefined {
  const docStart = findHtmlDocumentStart(text)
  if (docStart >= 0) {
    return text.slice(docStart)
  }

  return undefined
}

function extractScene3dHtmlCandidate(text: string): string {
  const withoutThinking = stripScene3dThinkingBlock(text)

  const completeFence = extractBestCompleteFencedHtml(withoutThinking)
  if (completeFence) {
    return completeFence
  }

  const openFence = extractOpenFencedHtml(withoutThinking)
  if (openFence) {
    return openFence
  }

  const withoutClosedFences = withoutThinking.replace(HTML_FENCE_RE, '').trim()
  const looseDocument = extractLooseHtmlDocument(withoutClosedFences)
  if (looseDocument) {
    return looseDocument
  }

  const partial = extractPartialHtmlFromStream(withoutThinking)
  return partial
}

/** 从含 SCENE3D_THINKING 与多个 markdown 围栏的 AI 回复中提取可运行的 HTML 文档。 */
export function extractScene3dHtmlFromAiText(text: string): string {
  const candidate = extractScene3dHtmlCandidate(text)
  return candidate ? stabilizePartialHtml(candidate) : ''
}

/** 流式生成过程中提取尚未闭合的 HTML，忽略思考段与仅含思考的围栏。 */
export function extractScene3dPartialHtmlFromStream(text: string): string {
  const candidate = extractScene3dHtmlCandidate(text)
  return candidate ? stabilizePartialHtml(candidate) : ''
}
