import {
  APP_CAPABILITY_TAG_3D,
  APP_CAPABILITY_TAG_AI,
  APP_CAPABILITY_TAG_FILES,
  APP_CAPABILITY_TAG_TERMINAL,
  formatAppCapabilityTagForDisplay,
  hasAppCapabilityTag,
  normalizeAppCapabilityTag,
  type AppCapabilityTag,
} from '../appstore/app-capability-tags.ts'
import { GENERATED_APP_AI_BASE_URL } from '../generated/generated-app-ai-types.ts'

export const GRANTABLE_ICODE_CAPABILITY_TAGS = [
  APP_CAPABILITY_TAG_3D,
  APP_CAPABILITY_TAG_AI,
  APP_CAPABILITY_TAG_FILES,
  APP_CAPABILITY_TAG_TERMINAL,
] as const

export type GrantableIcodeCapabilityTag = (typeof GRANTABLE_ICODE_CAPABILITY_TAGS)[number]

export type ICodeCapabilityRequest = {
  tag: GrantableIcodeCapabilityTag
  reason: string
}

const REQUEST_HEAD = '<<<<<<< REQUEST_CAPABILITY'
const REQUEST_DIVIDER = '======='
const REQUEST_END = '>>>>>>> END'

const GRANTABLE_TAG_SET = new Set<string>(GRANTABLE_ICODE_CAPABILITY_TAGS)

const THREE_D_USAGE_PATTERNS = [
  /\bTHREE\./,
  /three\.js/i,
  /WebGLRenderingContext/,
  /\bRAPIER\b/,
  /new\s+RAPIER\./i,
  /instant-app-tags[^>]*content=["'][^"']*3d/i,
]

const AI_RUNTIME_USAGE_PATTERNS = [
  /__instant-ai/i,
  /instant-os\.local\/v1/i,
  new RegExp(GENERATED_APP_AI_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  /chat\/completions/,
]

const FILES_RUNTIME_USAGE_PATTERNS = [
  /InstantOS\s*\.\s*files\b/,
  /__INSTANT_FILES__/,
  /instant-generated-app-files-request/,
  /filesListVolumes|filesReadText|filesWriteText/,
]

const TERMINAL_RUNTIME_USAGE_PATTERNS = [
  /InstantOS\s*\.\s*terminal\b/,
  /__INSTANT_TERMINAL__/,
  /instant-generated-app-terminal-request/,
]

export function isGrantableIcodeCapabilityTag(tag: string): tag is GrantableIcodeCapabilityTag {
  return GRANTABLE_TAG_SET.has(tag)
}

function isMarkerLine(line: string, marker: string): boolean {
  return line.trim() === marker
}

function stripOuterCodeFence(content: string): string {
  const trimmed = content.trim()
  const match = trimmed.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```\s*$/i)
  return match?.[1] ?? content
}

function ungrantedCapabilityTags(grantedTags: readonly string[]): GrantableIcodeCapabilityTag[] {
  return GRANTABLE_ICODE_CAPABILITY_TAGS.filter((tag) => !hasAppCapabilityTag(grantedTags, tag))
}

function formatUngrantedCapabilityLines(ungranted: readonly GrantableIcodeCapabilityTag[]): string {
  if (ungranted.length === 0) {
    return '（无，所需能力均已授予）'
  }

  return ungranted
    .map((tag) => {
      if (tag === APP_CAPABILITY_TAG_3D) {
        return '- 3d：Three.js / WebGL / Rapier 物理、3D 模型目录、真 3D 场景与相机'
      }
      if (tag === APP_CAPABILITY_TAG_FILES) {
        return '- files：通过 InstantOS.files 读写系统文件（/user、/models、/system、/mount/…）'
      }
      if (tag === APP_CAPABILITY_TAG_TERMINAL) {
        return '- terminal：通过 InstantOS.terminal 创建系统终端会话并 exec 命令（AI 映射到虚拟文件系统）'
      }
      return `- ai：应用运行时调用系统 AI（${GENERATED_APP_AI_BASE_URL}/chat/completions 或注入的 OpenAI 客户端）`
    })
    .join('\n')
}

export function formatGrantableCapabilityLabel(tag: GrantableIcodeCapabilityTag): string {
  if (tag === APP_CAPABILITY_TAG_3D) {
    return '3D 能力'
  }
  if (tag === APP_CAPABILITY_TAG_FILES) {
    return '文件访问能力'
  }
  if (tag === APP_CAPABILITY_TAG_TERMINAL) {
    return '终端能力'
  }
  return '运行时 AI 能力'
}

export function formatGrantableCapabilityDescription(tag: GrantableIcodeCapabilityTag): string {
  if (tag === APP_CAPABILITY_TAG_3D) {
    return '允许 AI 使用 3D 引擎'
  }
  if (tag === APP_CAPABILITY_TAG_FILES) {
    return 'AI 可以在生成的 App 中读写系统文件'
  }
  if (tag === APP_CAPABILITY_TAG_TERMINAL) {
    return 'AI 可以在生成的 App 中使用系统终端会话'
  }
  return 'AI 可以在生成的 App 运行时调用 AI 能力'
}

export function buildIcodeCapabilityRequestPromptExtension(grantedTags: readonly string[]): string {
  const granted = GRANTABLE_ICODE_CAPABILITY_TAGS.filter((tag) =>
    hasAppCapabilityTag(grantedTags, tag),
  )
  const ungranted = ungrantedCapabilityTags(grantedTags)
  const grantedLabel =
    granted.length > 0
      ? granted.map((tag) => formatAppCapabilityTagForDisplay(tag)).join('、')
      : '无'

  return `【程序生成能力 · 最高优先级】
以下规则优先于「改代码 / 输出 HTML / SEARCH/REPLACE」等一切其他指令。

当前已授予：${grantedLabel}
当前未授予（用户点击「授予能力」前不得使用）：
${formatUngrantedCapabilityLines(ungranted)}

判定：用户消息或你要实现的功能若依赖未授予的 3d、ai 或 files，即视为「需要该能力」。

若需要尚未授予的能力，本轮回复必须且只能包含：
1. 自然语言（中文）：说明为什么需要、授予后你会做什么
2. 一个或多个 REQUEST_CAPABILITY 块（每种能力单独一块）
3. 禁止输出 SEARCH/REPLACE、禁止输出完整 HTML、禁止输出任何源码

禁止用以下方式绕过能力限制（仍视为需要对应能力，必须改走 REQUEST_CAPABILITY）：
- 未授予 3d：Three.js、WebGL、Canvas 伪 3D、CSS 3D transform 模拟场景、Rapier、3d 模型 URL
- 未授予 ai：fetch/OpenAI 调用 ${GENERATED_APP_AI_BASE_URL}、任何 chat/completions、应用内大模型对话
- 未授予 files：InstantOS.files、读写 /user /models /system /mount 等系统路径

只有所需能力均已授予，或任务本身不需要未授予能力时，才允许输出 SEARCH/REPLACE 或完整 HTML。

REQUEST_CAPABILITY 格式（tag 只能是 3d、ai 或 files，已授予的不要重复请求）：

\`\`\`
<<<<<<< REQUEST_CAPABILITY
3d
=======
说明为何需要此能力（中文，简洁）。
>>>>>>> END
\`\`\``
}

export function buildIcodeCapabilityUserPromptSection(grantedTags: readonly string[]): string {
  const granted = GRANTABLE_ICODE_CAPABILITY_TAGS.filter((tag) =>
    hasAppCapabilityTag(grantedTags, tag),
  )
  const ungranted = ungrantedCapabilityTags(grantedTags)
  const grantedLabel =
    granted.length > 0
      ? granted.map((tag) => formatAppCapabilityTagForDisplay(tag)).join('、')
      : '无'

  if (ungranted.length === 0) {
    return `【程序生成能力】已授予：${grantedLabel}。可按用户消息直接改代码。`
  }

  return [
    `【程序生成能力】已授予：${grantedLabel}`,
    '未授予（若用户消息需要，必须先 REQUEST_CAPABILITY，禁止先写相关代码）：',
    formatUngrantedCapabilityLines(ungranted),
  ].join('\n')
}

export function buildIcodeBootstrapEditRules(): string {
  return `【从零创建】当前几乎无可用源码。
- 若不需要尚未授予的程序生成能力：可输出完整 <!DOCTYPE html> 文档（可用 \`\`\`html 包裹），不要 SEARCH/REPLACE
- 完整 HTML 会自动应用并出现在预览区，自然语言用一两句话说明实现了什么即可，不要写「如何保存/粘贴/运行这段代码」的教程
- 若需要尚未授予的程序生成能力：禁止输出任何 HTML 或 SEARCH/REPLACE，只能自然语言 + REQUEST_CAPABILITY`
}

export function detect3dCapabilityUsage(text: string): boolean {
  return THREE_D_USAGE_PATTERNS.some((pattern) => pattern.test(text))
}

export function detectAiCapabilityUsage(text: string): boolean {
  return AI_RUNTIME_USAGE_PATTERNS.some((pattern) => pattern.test(text))
}

export function detectFilesCapabilityUsage(text: string): boolean {
  return FILES_RUNTIME_USAGE_PATTERNS.some((pattern) => pattern.test(text))
}

export function detectTerminalCapabilityUsage(text: string): boolean {
  return TERMINAL_RUNTIME_USAGE_PATTERNS.some((pattern) => pattern.test(text))
}

export function inferMissingCapabilityRequests(
  content: string,
  html: string,
  grantedTags: readonly AppCapabilityTag[],
): ICodeCapabilityRequest[] {
  const requestedTags = new Set(parseCapabilityRequestBlocks(content).map((request) => request.tag))
  const inferred: ICodeCapabilityRequest[] = []

  if (
    !hasAppCapabilityTag(grantedTags, APP_CAPABILITY_TAG_3D) &&
    !requestedTags.has(APP_CAPABILITY_TAG_3D) &&
    detect3dCapabilityUsage(html)
  ) {
    inferred.push({
      tag: APP_CAPABILITY_TAG_3D,
      reason: '实现该功能需要使用 3D 引擎，请先授予 3D 能力。',
    })
  }

  if (
    !hasAppCapabilityTag(grantedTags, APP_CAPABILITY_TAG_AI) &&
    !requestedTags.has(APP_CAPABILITY_TAG_AI) &&
    detectAiCapabilityUsage(html)
  ) {
    inferred.push({
      tag: APP_CAPABILITY_TAG_AI,
      reason: '实现该功能需要应用在运行时调用 AI，请先授予运行时 AI 能力。',
    })
  }

  if (
    !hasAppCapabilityTag(grantedTags, APP_CAPABILITY_TAG_FILES) &&
    !requestedTags.has(APP_CAPABILITY_TAG_FILES) &&
    detectFilesCapabilityUsage(html)
  ) {
    inferred.push({
      tag: APP_CAPABILITY_TAG_FILES,
      reason: '实现该功能需要读写系统文件，请先授予文件访问能力。',
    })
  }

  if (
    !hasAppCapabilityTag(grantedTags, APP_CAPABILITY_TAG_TERMINAL) &&
    !requestedTags.has(APP_CAPABILITY_TAG_TERMINAL) &&
    detectTerminalCapabilityUsage(html)
  ) {
    inferred.push({
      tag: APP_CAPABILITY_TAG_TERMINAL,
      reason: '实现该功能需要使用系统终端会话，请先授予终端能力。',
    })
  }

  return inferred
}

export function mergeCapabilityRequests(
  ...groups: readonly ICodeCapabilityRequest[][]
): ICodeCapabilityRequest[] {
  const seen = new Set<GrantableIcodeCapabilityTag>()
  const merged: ICodeCapabilityRequest[] = []

  for (const group of groups) {
    for (const request of group) {
      if (seen.has(request.tag)) {
        continue
      }
      seen.add(request.tag)
      merged.push(request)
    }
  }

  return merged
}

export function parseCapabilityRequestBlocks(content: string): ICodeCapabilityRequest[] {
  const normalized = stripOuterCodeFence(content)
  const lines = normalized.split(/\r?\n/)
  const requests: ICodeCapabilityRequest[] = []
  let index = 0

  while (index < lines.length) {
    if (!isMarkerLine(lines[index], REQUEST_HEAD)) {
      index += 1
      continue
    }

    index += 1
    const tagLines: string[] = []
    while (index < lines.length && !isMarkerLine(lines[index], REQUEST_DIVIDER)) {
      tagLines.push(lines[index])
      index += 1
    }
    if (index >= lines.length) {
      break
    }

    index += 1
    const reasonLines: string[] = []
    while (index < lines.length && !isMarkerLine(lines[index], REQUEST_END)) {
      reasonLines.push(lines[index])
      index += 1
    }
    if (index >= lines.length) {
      break
    }

    index += 1
    const tagRaw = tagLines.join('\n').trim()
    const tag = normalizeAppCapabilityTag(tagRaw)
    if (tag && isGrantableIcodeCapabilityTag(tag)) {
      requests.push({
        tag,
        reason: reasonLines.join('\n').trim(),
      })
    }
  }

  return requests
}

export function stripCapabilityRequestBlocksFromContent(content: string): string {
  let result = stripOuterCodeFence(content)

  const fencedBlockPattern =
    /```(?:\w+)?\s*\n?[\s\S]*?<<<<<<< REQUEST_CAPABILITY[\s\S]*?>>>>>>> END[\s\S]*?```/gi
  result = result.replace(fencedBlockPattern, '')

  const blockPattern = /<<<<<<< REQUEST_CAPABILITY[\s\S]*?>>>>>>> END/g
  result = result.replace(blockPattern, '')

  const markers = [REQUEST_HEAD, REQUEST_DIVIDER, REQUEST_END]
  let cutAt = result.length
  for (const marker of markers) {
    const markerIndex = result.indexOf(marker)
    if (markerIndex !== -1 && markerIndex < cutAt) {
      cutAt = markerIndex
    }
  }

  result = result.slice(0, cutAt)
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

export function mergeSessionTagsWithCapability(
  tags: readonly AppCapabilityTag[],
  capability: GrantableIcodeCapabilityTag,
): AppCapabilityTag[] {
  const baseTags = tags.filter((tag) => tag !== capability)
  return [...baseTags, capability]
}

export function buildChatCapabilityRequests(
  content: string,
  grantedTags: readonly AppCapabilityTag[],
  html = '',
): Array<ICodeCapabilityRequest & { status: 'pending' | 'granted' }> {
  const merged = mergeCapabilityRequests(
    parseCapabilityRequestBlocks(content),
    inferMissingCapabilityRequests(content, html, grantedTags),
  )

  return merged.map((request) => ({
    ...request,
    status: hasAppCapabilityTag(grantedTags, request.tag) ? 'granted' : 'pending',
  }))
}

export function shouldRevertUngrantedCapabilityCode(
  content: string,
  html: string,
  existingHtml: string,
  grantedTags: readonly AppCapabilityTag[],
): boolean {
  if (html === existingHtml) {
    return false
  }

  const requests = buildChatCapabilityRequests(content, grantedTags, html)
  const pendingRequests = requests.filter((request) => request.status === 'pending')
  if (pendingRequests.length === 0) {
    return false
  }

  return pendingRequests.some((request) => {
    if (request.tag === APP_CAPABILITY_TAG_3D) {
      return detect3dCapabilityUsage(html)
    }
    if (request.tag === APP_CAPABILITY_TAG_FILES) {
      return detectFilesCapabilityUsage(html)
    }
    if (request.tag === APP_CAPABILITY_TAG_TERMINAL) {
      return detectTerminalCapabilityUsage(html)
    }
    return detectAiCapabilityUsage(html)
  })
}
