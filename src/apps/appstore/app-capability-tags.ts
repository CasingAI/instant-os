/** 应用能力标签白名单（内部存储一律小写） */
export const APP_CAPABILITY_TAG_3D = '3d' as const
export const APP_CAPABILITY_TAG_AI = 'ai' as const
export const APP_CAPABILITY_TAG_FILES = 'files' as const
export const APP_CAPABILITY_TAG_TERMINAL = 'terminal' as const
export const APP_CAPABILITY_TAG_WEBVIEW = 'webview' as const

export const APP_CAPABILITY_TAGS = [
  APP_CAPABILITY_TAG_3D,
  APP_CAPABILITY_TAG_AI,
  APP_CAPABILITY_TAG_FILES,
  APP_CAPABILITY_TAG_TERMINAL,
  APP_CAPABILITY_TAG_WEBVIEW,
  'game',
  'utility',
  'productivity',
  'creative',
  'audio',
  'persistent',
  'interactive',
  'canvas',
] as const

export type AppCapabilityTag = (typeof APP_CAPABILITY_TAGS)[number]

const TAG_SET = new Set<string>(APP_CAPABILITY_TAGS)

/** 对外 UI 展示的能力标签 */
export const APP_CAPABILITY_TAGS_VISIBLE: readonly AppCapabilityTag[] = [
  APP_CAPABILITY_TAG_3D,
  APP_CAPABILITY_TAG_AI,
  APP_CAPABILITY_TAG_FILES,
  APP_CAPABILITY_TAG_TERMINAL,
  APP_CAPABILITY_TAG_WEBVIEW,
]

export function normalizeAppCapabilityTag(raw: string): AppCapabilityTag | undefined {
  const normalized = raw.trim().toLowerCase()
  if (TAG_SET.has(normalized)) {
    return normalized as AppCapabilityTag
  }
  return undefined
}

export function filterAppCapabilityTags(tags: unknown): AppCapabilityTag[] {
  if (!Array.isArray(tags)) {
    return []
  }

  const seen = new Set<AppCapabilityTag>()
  const result: AppCapabilityTag[] = []

  for (const item of tags) {
    if (typeof item !== 'string') {
      continue
    }
    const normalized = normalizeAppCapabilityTag(item)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export function mergeAppCapabilityTags(...groups: unknown[]): AppCapabilityTag[] {
  const seen = new Set<AppCapabilityTag>()
  const result: AppCapabilityTag[] = []

  for (const group of groups) {
    for (const tag of filterAppCapabilityTags(group)) {
      if (seen.has(tag)) {
        continue
      }
      seen.add(tag)
      result.push(tag)
    }
  }

  return result
}

export function hasAppCapabilityTag(tags: unknown, tag: AppCapabilityTag): boolean {
  return filterAppCapabilityTags(tags).includes(tag)
}

export function formatAppCapabilityTagForDisplay(tag: AppCapabilityTag): string {
  if (tag === APP_CAPABILITY_TAG_3D) {
    return '3D'
  }
  if (tag === APP_CAPABILITY_TAG_AI) {
    return 'AI'
  }
  if (tag === APP_CAPABILITY_TAG_FILES) {
    return '文件'
  }
  if (tag === APP_CAPABILITY_TAG_TERMINAL) {
    return '终端'
  }
  if (tag === APP_CAPABILITY_TAG_WEBVIEW) {
    return 'WebView'
  }
  return tag
}

export function appCapabilityTagsForPrompt(): string {
  return APP_CAPABILITY_TAGS.join(', ')
}

export function visibleAppCapabilityTags(tags: unknown): AppCapabilityTag[] {
  return filterAppCapabilityTags(tags).filter((tag) =>
    (APP_CAPABILITY_TAGS_VISIBLE as readonly string[]).includes(tag),
  )
}
