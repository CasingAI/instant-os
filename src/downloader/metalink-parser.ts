import type { DownloadManifest, HashInfo, PieceInfo } from './downloader-types.ts'

export class MetalinkParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetalinkParseError'
  }
}

export type ParseMetalinkOptions = {
  /** 是否要求至少存在一个 URL；默认 true */
  requireUrls?: boolean
}

/**
 * 解析 RFC 5854 Metalink XML。
 * 首期支持单文件、等长 pieces、文件级 mirror URL。
 */
export function parseMetalink(
  xml: string,
  options?: ParseMetalinkOptions,
): DownloadManifest {
  const source = xml.trim()
  if (!source.startsWith('<')) {
    throw new MetalinkParseError('输入不是有效的 XML')
  }

  const fileBlock = extractFirstElement(source, 'file')
  if (!fileBlock) {
    throw new MetalinkParseError('未找到 <file> 元素')
  }

  const name = extractAttribute(fileBlock.openTag, 'name') ?? 'download'
  const totalSize = extractNumber(fileBlock.inner, 'size')
  if (totalSize === undefined || totalSize < 0) {
    throw new MetalinkParseError('未找到有效的 <size>')
  }

  const urls = extractUrls(fileBlock.inner)
  if (urls.length === 0 && options?.requireUrls !== false) {
    throw new MetalinkParseError('未找到可用的下载 URL')
  }

  const fileHash = extractHash(fileBlock.inner)
  const pieces = extractPieces(fileBlock.inner, totalSize, urls, fileHash)

  return {
    kind: 'metalink',
    name,
    totalSize,
    pieces,
  }
}

function extractPieces(
  fileInner: string,
  totalSize: number,
  fileUrls: string[],
  fileHash: HashInfo | undefined,
): PieceInfo[] {
  const piecesBlock = extractFirstElement(fileInner, 'pieces')
  if (!piecesBlock) {
    return [
      {
        index: 0,
        offset: 0,
        size: totalSize,
        urls: fileUrls,
        hash: fileHash,
      },
    ]
  }

  const pieceLength = extractAttributeNumber(piecesBlock.openTag, 'length')
  if (pieceLength === undefined || pieceLength <= 0) {
    throw new MetalinkParseError('未找到有效的 pieces length')
  }

  const hashType = extractAttribute(piecesBlock.openTag, 'type') ?? 'sha-256'
  const pieceHashes = extractAllTextElements(piecesBlock.inner, 'hash')
  if (pieceHashes.length === 0) {
    throw new MetalinkParseError('pieces 中未找到 hash')
  }

  const pieces: PieceInfo[] = []
  let offset = 0
  for (let i = 0; i < pieceHashes.length; i += 1) {
    const size = Math.min(pieceLength, totalSize - offset)
    if (size <= 0) {
      break
    }
    pieces.push({
      index: i,
      offset,
      size,
      urls: fileUrls,
      hash: { algorithm: normalizeHashAlgorithm(hashType), value: pieceHashes[i]! },
    })
    offset += size
  }

  return pieces
}

function extractUrls(fileInner: string): string[] {
  // 优先从 <resources><url>...</url></resources> 提取
  const resourcesBlock = extractFirstElement(fileInner, 'resources')
  const searchArea = resourcesBlock?.inner ?? fileInner
  const urls = extractAllTextElements(searchArea, 'url')
  return urls.map((url) => url.trim()).filter(Boolean)
}

function extractHash(inner: string): HashInfo | undefined {
  const block = extractFirstElement(inner, 'hash')
  if (!block) return undefined
  const type = extractAttribute(block.openTag, 'type') ?? 'sha-256'
  const value = block.inner.trim()
  if (!value) return undefined
  return { algorithm: normalizeHashAlgorithm(type), value }
}

function normalizeHashAlgorithm(input: string): HashInfo['algorithm'] {
  const normalized = input.toLowerCase().replace(/-/g, '')
  if (normalized === 'sha256' || normalized === 'sha2') return 'sha-256'
  if (normalized === 'sha1') return 'sha-1'
  if (normalized === 'md5') return 'md5'
  return 'sha-256'
}

type XmlElementBlock = { openTag: string; inner: string }

function extractFirstElement(source: string, tagName: string): XmlElementBlock | undefined {
  const regex = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'i')
  const match = regex.exec(source)
  if (!match) return undefined
  return { openTag: match[1]!, inner: match[2]! }
}

function extractAllTextElements(source: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi')
  const result: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(source)) !== null) {
    result.push(match[1]!.trim())
  }
  return result
}

function extractAttribute(openTag: string, name: string): string | undefined {
  const regex = new RegExp(`${name}=["']([^"']+)["']`, 'i')
  const match = regex.exec(openTag)
  return match?.[1]
}

function extractNumber(source: string, tagName: string): number | undefined {
  const block = extractFirstElement(source, tagName)
  if (!block) return undefined
  const parsed = Number(block.inner.trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function extractAttributeNumber(source: string, name: string): number | undefined {
  const value = extractAttribute(source, name)
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
