import {
  APP_CAPABILITY_TAG_3D,
  filterAppCapabilityTags,
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

export function inferGeneratedAppTags(html: string): string[] {
  if (THREEJS_CONTENT_MARKERS.some((pattern) => pattern.test(html))) {
    return [APP_CAPABILITY_TAG_3D]
  }

  return []
}

export function generatedAppNeeds3d(html: string, context: GeneratedAppTagContext = {}): boolean {
  if (filterAppCapabilityTags(context.tags).includes(APP_CAPABILITY_TAG_3D)) {
    return true
  }

  if (hasGeneratedAppTag(html, APP_CAPABILITY_TAG_3D)) {
    return true
  }

  if (inferGeneratedAppTags(html).includes(APP_CAPABILITY_TAG_3D)) {
    return true
  }

  return appContextSuggests3d(context)
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

export function ensureGeneratedAppTags(
  html: string,
  context: GeneratedAppTagContext = {},
): string {
  if (!generatedAppNeeds3d(html, context)) {
    return html
  }

  return upsertGeneratedAppTagsMeta(html, [APP_CAPABILITY_TAG_3D])
}
