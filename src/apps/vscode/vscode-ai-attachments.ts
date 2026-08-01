/**
 * VS Code AI 图片附件：路径引用、粘贴落盘、多模态组装。
 */
import type OpenAI from 'openai'
import { platformHasVisionModel } from '../../ai/subagent/index.ts'
import { fileNameExtension } from '../../os/file-open-registry.ts'
import { filesCreateBinary, filesReadBlob } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { ensureTmpFolder } from '../files/files-tmp.ts'
import { osNowMs } from '../../os/os-clock.ts'

export const VSCODE_AI_NO_VISION_ATTACH_ERROR =
  '没有可用的视觉模型，无法附加图片。请在钥匙串中启用支持图像识别的模型。'

export type VscodeAiImageAttachment = {
  id: string
  path: string
  name: string
  mimeType: string
  /**
   * 已就绪的预览地址（data:/blob:/http(s):）。
   * 子 Agent 详情可从 transcript 的 image_url 带回，避免再读 VFS。
   */
  previewUrl?: string
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'])

/** Instant 打开对话框用的图片后缀列表 */
export const VSCODE_AI_IMAGE_ACCEPT_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
] as const

const ATTACH_TMP_PREFIX = '/tmp/vscode-ai-attachments'

let attachSeq = 0

function nextAttachId(): string {
  attachSeq += 1
  return `img-${osNowMs()}-${attachSeq}`
}

/** 平台是否允许在 VS Code AI 中附加图片 */
export function vscodeAiCanAttachImages(): boolean {
  return platformHasVisionModel()
}

export function assertVscodeAiCanAttachImages(): void {
  if (!vscodeAiCanAttachImages()) {
    throw new Error(VSCODE_AI_NO_VISION_ATTACH_ERROR)
  }
}

export function isVscodeAiImagePath(path: string): boolean {
  const name = path.split('/').pop() ?? path
  const ext = fileNameExtension(name)
  return ext !== undefined && IMAGE_EXTENSIONS.has(ext)
}

export function isVscodeAiImageMime(mime: string | undefined): boolean {
  if (!mime) return false
  return mime.toLowerCase().startsWith('image/')
}

/** 拼进无视觉父模型的用户文本 */
export function formatVscodeAiImageAttachmentSection(
  attachments: readonly VscodeAiImageAttachment[],
): string {
  if (attachments.length === 0) return ''
  const lines = attachments.map((item) => `- ${item.path}`)
  return `【附件图片】\n${lines.join('\n')}`
}

export function mergeUserTextWithImageAttachments(
  userText: string,
  attachments: readonly VscodeAiImageAttachment[],
): string {
  const section = formatVscodeAiImageAttachmentSection(attachments)
  if (!section) return userText
  const trimmed = userText.trim()
  if (!trimmed) return section
  return `${userText.trimEnd()}\n\n${section}`
}

const IMAGE_PATH_MARKERS = ['【附件图片】', '【image_paths】'] as const

/** 从文案里的路径块解析 VFS 绝对路径（主聊天附件段 / 委派参数回显） */
export function parseVscodeAiImagePathsFromText(text: string): string[] {
  if (!text.trim()) return []
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    const path = raw.trim()
    if (!path.startsWith('/') || seen.has(path)) return
    seen.add(path)
    out.push(path)
  }
  const lines = text.split('\n')
  let inSection = false
  for (const line of lines) {
    const trimmed = line.trim()
    if ((IMAGE_PATH_MARKERS as readonly string[]).includes(trimmed)) {
      inSection = true
      continue
    }
    if (inSection) {
      const bullet = /^-\s*(\/.+)$/.exec(trimmed)
      if (bullet) {
        add(bullet[1])
        continue
      }
      if (trimmed && !trimmed.startsWith('-')) {
        inSection = false
      }
    }
  }
  return out
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const base64 = btoa(binary)
  const mime = blob.type || 'application/octet-stream'
  return `data:${mime};base64,${base64}`
}

/** 读取 VFS 图片为 data URL（供 vision API） */
export async function readVscodeAiImageDataUrl(path: string): Promise<{
  dataUrl: string
  mimeType: string
}> {
  const blob = await filesReadBlob(path)
  const mimeType = blob.type || 'image/png'
  if (!isVscodeAiImageMime(mimeType) && !isVscodeAiImagePath(path)) {
    throw new Error(`不是图片文件：${path}`)
  }
  const dataUrl = await blobToDataUrl(blob)
  return { dataUrl, mimeType }
}

/** 父模型有视觉时：组装 multimodal user content parts（不含 reminder；reminder 由调用方写入 text） */
export async function buildVscodeAiMultimodalUserContent(
  text: string,
  paths: readonly string[],
): Promise<OpenAI.Chat.ChatCompletionContentPart[]> {
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: 'text', text },
  ]
  for (const path of paths) {
    const { dataUrl } = await readVscodeAiImageDataUrl(path)
    parts.push({
      type: 'image_url',
      image_url: { url: dataUrl },
    })
  }
  return parts
}

function extensionForMime(mime: string): string {
  const lower = mime.toLowerCase()
  if (lower.includes('png')) return 'png'
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg'
  if (lower.includes('gif')) return 'gif'
  if (lower.includes('webp')) return 'webp'
  if (lower.includes('svg')) return 'svg'
  return 'png'
}

/** 粘贴/导入图片写入 /tmp/vscode-ai-attachments/{chatSessionId}/ */
export async function writeVscodeAiPastedImage(params: {
  chatSessionId: string
  bytes: ArrayBuffer
  mimeType: string
  fileName?: string
}): Promise<VscodeAiImageAttachment> {
  assertVscodeAiCanAttachImages()
  const sessionId = params.chatSessionId.trim() || 'anonymous'
  const dir = joinFilesAbsolutePath(ATTACH_TMP_PREFIX, sessionId)
  await ensureTmpFolder(dir)
  const ext =
    params.fileName && fileNameExtension(params.fileName)
      ? fileNameExtension(params.fileName)!
      : extensionForMime(params.mimeType)
  const name = `paste-${nextAttachId()}.${ext}`
  const path = joinFilesAbsolutePath(dir, name)
  const mimeType = params.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`
  await filesCreateBinary(path, params.bytes, mimeType)
  return {
    id: nextAttachId(),
    path,
    name,
    mimeType,
  }
}

export function attachmentFromVfsPath(path: string, mimeType?: string): VscodeAiImageAttachment {
  assertVscodeAiCanAttachImages()
  const trimmed = path.trim()
  if (!trimmed.startsWith('/')) {
    throw new Error('图片路径必须是绝对路径')
  }
  if (!isVscodeAiImagePath(trimmed) && !isVscodeAiImageMime(mimeType)) {
    throw new Error(`不是图片文件：${trimmed}`)
  }
  const name = trimmed.split('/').pop() || trimmed
  return {
    id: nextAttachId(),
    path: trimmed,
    name,
    mimeType: mimeType || `image/${fileNameExtension(name) || 'png'}`,
  }
}

export function normalizeVscodeAiImageAttachments(
  raw: unknown,
): VscodeAiImageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const result: VscodeAiImageAttachment[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as {
      id?: unknown
      path?: unknown
      name?: unknown
      mimeType?: unknown
      previewUrl?: unknown
    }
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    if (typeof item.path !== 'string' || !item.path.trim()) continue
    const path = item.path.trim()
    const name =
      typeof item.name === 'string' && item.name.trim()
        ? item.name.trim()
        : path.split('/').pop() || path
    const mimeType =
      typeof item.mimeType === 'string' && item.mimeType.trim()
        ? item.mimeType.trim()
        : 'image/png'
    const previewUrl =
      typeof item.previewUrl === 'string' && item.previewUrl.trim()
        ? item.previewUrl.trim()
        : undefined
    result.push({
      id: item.id.trim(),
      path,
      name,
      mimeType,
      ...(previewUrl ? { previewUrl } : {}),
    })
  }
  return result.length > 0 ? result : undefined
}

function mimeFromDataUrl(url: string): string {
  const match = /^data:([^;,]+)/i.exec(url)
  return match?.[1]?.trim() || 'image/png'
}

/**
 * 从多模态 user content 抽出 image_url，供聊天气泡直接预览。
 * 持久化占位（vscode-ai-image-omitted）会跳过，改由路径附件回退。
 */
export function attachmentsFromMultimodalContent(
  messageId: string,
  content: unknown,
): VscodeAiImageAttachment[] | undefined {
  if (!Array.isArray(content)) return undefined
  const out: VscodeAiImageAttachment[] = []
  for (let index = 0; index < content.length; index += 1) {
    const part = content[index]
    if (!part || typeof part !== 'object') continue
    const typed = part as {
      type?: unknown
      image_url?: { url?: unknown } | string
    }
    if (typed.type !== 'image_url') continue
    const rawUrl =
      typeof typed.image_url === 'string'
        ? typed.image_url
        : typeof typed.image_url?.url === 'string'
          ? typed.image_url.url
          : ''
    const url = rawUrl.trim()
    if (!url || url.includes('vscode-ai-image-omitted')) continue
    const isPreview =
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('http://') ||
      url.startsWith('https://')
    out.push({
      id: `${messageId}-content-img-${index}`,
      path: isPreview ? `${messageId}/image-${out.length + 1}` : url,
      name: `图片 ${out.length + 1}`,
      mimeType: url.startsWith('data:') ? mimeFromDataUrl(url) : 'image/png',
      ...(isPreview ? { previewUrl: url } : {}),
    })
  }
  return out.length > 0 ? out : undefined
}
