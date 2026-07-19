import {
  APP_CAPABILITY_TAG_3D,
  APP_CAPABILITY_TAG_AI,
  APP_CAPABILITY_TAG_FILES,
  APP_CAPABILITY_TAG_TERMINAL,
  filterAppCapabilityTags,
  mergeAppCapabilityTags,
} from '../appstore/app-capability-tags.ts'

export const GENERATED_APP_TAGS_META = 'instant-app-tags'

/** @deprecated 使用 APP_CAPABILITY_TAG_3D */
export const GENERATED_APP_TAG_3D = APP_CAPABILITY_TAG_3D

const TAG_SPLIT_PATTERN = /[,，;|]+/

const META_TAG_PATTERN = new RegExp(
  `<meta\\s+[^>]*name=["']${GENERATED_APP_TAGS_META}["'][^>]*content=["']([^"']*)["'][^>]*>`,
  'gi',
)

const META_TAG_ALT_PATTERN = new RegExp(
  `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*name=["']${GENERATED_APP_TAGS_META}["'][^>]*>`,
  'gi',
)

const COMMENT_TAG_PATTERN = /<!--\s*instant-app-tags:\s*([\s\S]*?)\s*-->/gi

function splitTagTokens(raw: string): string[] {
  return raw
    .split(TAG_SPLIT_PATTERN)
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0)
}

function collectMetaContents(html: string): string[] {
  const contents: string[] = []

  for (const pattern of [META_TAG_PATTERN, META_TAG_ALT_PATTERN]) {
    pattern.lastIndex = 0
    let match = pattern.exec(html)
    while (match) {
      const value = match[1]?.trim()
      if (value) {
        contents.push(value)
      }
      match = pattern.exec(html)
    }
  }

  COMMENT_TAG_PATTERN.lastIndex = 0
  let commentMatch = COMMENT_TAG_PATTERN.exec(html)
  while (commentMatch) {
    const value = commentMatch[1]?.trim()
    if (value) {
      contents.push(value)
    }
    commentMatch = COMMENT_TAG_PATTERN.exec(html)
  }

  return contents
}


export function parseGeneratedAppTags(html: string): string[] {
  const contents = collectMetaContents(html)
  if (contents.length === 0) {
    return []
  }

  return filterAppCapabilityTags(contents.flatMap(splitTagTokens))
}

export function hasGeneratedAppTag(html: string, tag: string): boolean {
  const normalized = tag.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return parseGeneratedAppTags(html).includes(normalized)
}

const THREEJS_CONTENT_MARKERS = [
  /from\s+['"]three['"]/i,
  /THREE\.WebGLRenderer/i,
  /getContext\(\s*['"]webgl2?['"]\s*\)/i,
  /GLTFLoader/i,
  /OrbitControls/i,
]

export type GeneratedAppTagContext = {
  name?: string
  description?: string
  category?: string
  tagline?: string
  longDescription?: string
  tags?: string[]
}

const THREE_D_CONTEXT_PATTERN = /3\s*d|三维|立体|three\s*-?\s*d/i
const AI_CONTEXT_PATTERN =
  /\bai\b|人工智能|智能助手|大模型|语言模型|gpt|llm|chatgpt|对话生成|ai\s*应用/i

function joinAppContextText(context: GeneratedAppTagContext): string {
  return [context.name, context.description, context.category, context.tagline, context.longDescription]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0)
    .join(' ')
}

export function inferTagsFromAppContext(context: GeneratedAppTagContext): string[] {
  const text = joinAppContextText(context)
  if (!text) {
    return []
  }

  if (THREE_D_CONTEXT_PATTERN.test(text)) {
    return [APP_CAPABILITY_TAG_3D]
  }

  return []
}

export function appContextSuggests3d(context: GeneratedAppTagContext): boolean {
  return inferTagsFromAppContext(context).includes(APP_CAPABILITY_TAG_3D)
}

export function appContextSuggestsAi(context: GeneratedAppTagContext): boolean {
  const text = joinAppContextText(context)
  if (!text) {
    return false
  }

  return AI_CONTEXT_PATTERN.test(text)
}

const AI_CONTENT_MARKERS = [
  /instant-os\.local\/v1/i,
  /__INSTANT_AI_BASE_URL__/i,
  /new\s+OpenAI\s*\(/i,
  /chat\.completions\.create/i,
]

const FILES_CONTENT_MARKERS = [
  /InstantOS\s*\.\s*files\b/,
  /__INSTANT_FILES__/,
  /instant-generated-app-files-request/,
]

const TERMINAL_CONTENT_MARKERS = [
  /InstantOS\s*\.\s*terminal\b/,
  /__INSTANT_TERMINAL__/,
  /instant-generated-app-terminal-request/,
]

export function inferGeneratedAppTags(html: string): string[] {
  const tags: string[] = []

  if (THREEJS_CONTENT_MARKERS.some((pattern) => pattern.test(html))) {
    tags.push(APP_CAPABILITY_TAG_3D)
  }

  if (AI_CONTENT_MARKERS.some((pattern) => pattern.test(html))) {
    tags.push(APP_CAPABILITY_TAG_AI)
  }

  if (FILES_CONTENT_MARKERS.some((pattern) => pattern.test(html))) {
    tags.push(APP_CAPABILITY_TAG_FILES)
  }

  if (TERMINAL_CONTENT_MARKERS.some((pattern) => pattern.test(html))) {
    tags.push(APP_CAPABILITY_TAG_TERMINAL)
  }

  return tags
}

/** 预览/已安装应用是否需在运行时注入 3D 桥接（仅看 HTML，与项目配置开关无关） */
export function generatedAppRuntimeUses3d(html: string): boolean {
  if (hasGeneratedAppTag(html, APP_CAPABILITY_TAG_3D)) {
    return true
  }

  return inferGeneratedAppTags(html).includes(APP_CAPABILITY_TAG_3D)
}

/** 是否需注入 Files 桥（meta tags 含 files，或源码调用 InstantOS.files） */
export function generatedAppRuntimeUsesFiles(html: string): boolean {
  if (hasGeneratedAppTag(html, APP_CAPABILITY_TAG_FILES)) {
    return true
  }

  return inferGeneratedAppTags(html).includes(APP_CAPABILITY_TAG_FILES)
}

/** 是否需注入 Terminal 桥（meta tags 含 terminal，或源码调用 InstantOS.terminal） */
export function generatedAppRuntimeUsesTerminal(html: string): boolean {
  if (hasGeneratedAppTag(html, APP_CAPABILITY_TAG_TERMINAL)) {
    return true
  }

  return inferGeneratedAppTags(html).includes(APP_CAPABILITY_TAG_TERMINAL)
}

/**
 * @deprecated 使用 generatedAppRuntimeUses3d；保留别名以免外部误用配置 tags 触发注入
 */
export function generatedAppNeeds3d(html: string, _context: GeneratedAppTagContext = {}): boolean {
  return generatedAppRuntimeUses3d(html)
}

export function buildGeneratedAppTagsMeta(tags: string[]): string {
  const normalized = filterAppCapabilityTags(tags)

  const content = normalized.join(',')
  return `<meta name="${GENERATED_APP_TAGS_META}" content="${content}">`
}

export function stripGeneratedAppTagsMarkup(html: string): string {
  const metaPattern = new RegExp(
    `<meta\\s+[^>]*name=["']${GENERATED_APP_TAGS_META}["'][^>]*content=["'][^"']*["'][^>]*>`,
    'gi',
  )
  const metaAltPattern = new RegExp(
    `<meta\\s+[^>]*content=["'][^"']*["'][^>]*name=["']${GENERATED_APP_TAGS_META}["'][^>]*>`,
    'gi',
  )

  return html.replace(metaPattern, '').replace(metaAltPattern, '').replace(COMMENT_TAG_PATTERN, '')
}

export function upsertGeneratedAppTagsMeta(html: string, tags: string[]): string {
  const normalized = filterAppCapabilityTags(tags)

  if (normalized.length === 0) {
    return html
  }

  const cleaned = stripGeneratedAppTagsMarkup(html)
  const meta = buildGeneratedAppTagsMeta(normalized)

  if (/<head[\s>]/i.test(cleaned)) {
    return cleaned.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${meta}`)
  }

  if (/<html[\s>]/i.test(cleaned)) {
    return cleaned.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${meta}</head>`)
  }

  return `<head>${meta}</head>\n${cleaned}`
}

export function ensureGeneratedAppTags(html: string, _context: GeneratedAppTagContext = {}): string {
  const tags = mergeAppCapabilityTags(
    parseGeneratedAppTags(html),
    generatedAppRuntimeUses3d(html) ? [APP_CAPABILITY_TAG_3D] : [],
    generatedAppRuntimeUsesFiles(html) ? [APP_CAPABILITY_TAG_FILES] : [],
    generatedAppRuntimeUsesTerminal(html) ? [APP_CAPABILITY_TAG_TERMINAL] : [],
    inferGeneratedAppTags(html),
  )

  if (tags.length === 0) {
    return html
  }

  return upsertGeneratedAppTagsMeta(html, tags)
}
