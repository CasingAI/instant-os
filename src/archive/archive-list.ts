import { gunzipSync } from 'fflate'
import { detectArchiveFormat, type ArchiveCodecFormat } from './archive-codec.ts'
import { listIsoEntries } from './archive-iso.ts'

/**
 * 归档列目录（只读元数据，不解压内容）。
 * - zip：解析尾部中央目录（EOCD → CD），拿到每个条目的名字 / 原始大小 / 压缩后大小 /
 *   压缩方法 / DOS 时间；不用 fflate Unzip 是因为它不暴露 mtime 与目录条目。
 * - tar / tar.gz：顺序扫 512 字节头、跳过数据区。
 * - gzip-file：整体 gunzip 后作为单个条目。
 * - iso：ISOReader 遍历 Joliet/PVD 树（只列文件，目录由路径前缀推导）。
 */

export type ArchiveEntryMeta = {
  /** 归档内相对路径（目录名已去尾斜杠） */
  path: string
  /** 原始大小（未压缩）；目录为 0 */
  originalSize: number
  /** 压缩后大小；tar 无压缩层信息时等于原始大小 */
  compressedSize: number
  isDirectory: boolean
  /** 修改时间（epoch ms）；缺失为 undefined */
  mtime?: number
  /** 压缩方法：store / deflate / bzip2 / lzma / gzip；未知为 undefined */
  compressionMethod?: string
}

export type ArchiveListing = {
  format: ArchiveCodecFormat
  entries: ArchiveEntryMeta[]
}

const EOCD_SIGNATURE = 0x06054b50
const CD_SIGNATURE = 0x02014b50

function readUint16At(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint32At(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>>
    0
  )
}

/** 从文件尾部向前搜索 EOCD（允许最长 64KB 的 comment 区）。 */
function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const maxComment = 0xffff
  const min = Math.max(0, bytes.byteLength - 22 - maxComment)
  for (let i = bytes.byteLength - 22; i >= min; i--) {
    if (readUint32At(bytes, i) === EOCD_SIGNATURE) return i
  }
  return -1
}

/**
 * zip 条目名编码修复：与 archive-unzip 同语义。
 * 先按 UTF-8 解码；失败则按 GB18030（覆盖 GBK，国内常见 ZIP）。
 */
function decodeZipNameBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 非合法 UTF-8，尝试本地中文编码
  }
  try {
    return new TextDecoder('gb18030').decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

/** DOS 日期时间 → epoch ms；非法值返回 undefined。 */
function dosDateTimeToEpochMs(dosTime: number, dosDate: number): number | undefined {
  const seconds = (dosTime & 0x1f) * 2
  const minutes = (dosTime >> 5) & 0x3f
  const hours = (dosTime >> 11) & 0x1f
  const day = dosDate & 0x1f
  const month = ((dosDate >> 5) & 0x0f) - 1
  const year = ((dosDate >> 9) & 0x7f) + 1980
  if (year < 1980 || month < 0 || month > 11 || day < 1 || day > 31) return undefined
  return new Date(year, month, day, hours, minutes, seconds).getTime()
}

const ZIP_METHOD_NAMES: Readonly<Record<number, string | undefined>> = {
  0: 'store',
  8: 'deflate',
  12: 'bzip2',
  14: 'lzma',
}

/** 解析 zip 中央目录，返回条目元数据（不解压内容）。 */
export function listZipEntries(bytes: Uint8Array): ArchiveEntryMeta[] {
  const eocdOffset = findEndOfCentralDirectory(bytes)
  if (eocdOffset < 0) throw new Error('不是有效的 ZIP 归档')
  const totalEntries = readUint16At(bytes, eocdOffset + 10)
  const cdOffset = readUint32At(bytes, eocdOffset + 16)
  const out: ArchiveEntryMeta[] = []
  let offset = cdOffset
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > bytes.byteLength) break
    if (readUint32At(bytes, offset) !== CD_SIGNATURE) break
    const method = readUint16At(bytes, offset + 10)
    const dosTime = readUint16At(bytes, offset + 12)
    const dosDate = readUint16At(bytes, offset + 14)
    const compressedSize = readUint32At(bytes, offset + 20)
    const originalSize = readUint32At(bytes, offset + 24)
    const nameLength = readUint16At(bytes, offset + 28)
    const extraLength = readUint16At(bytes, offset + 30)
    const commentLength = readUint16At(bytes, offset + 32)
    const nameStart = offset + 46
    if (nameStart + nameLength > bytes.byteLength) break
    let name = decodeZipNameBytes(bytes.subarray(nameStart, nameStart + nameLength))
    const isDirectory = name.endsWith('/')
    if (isDirectory) name = name.replace(/\/+$/, '')
    out.push({
      path: name,
      originalSize: isDirectory ? 0 : originalSize,
      compressedSize: isDirectory ? 0 : compressedSize,
      isDirectory,
      mtime: dosDateTimeToEpochMs(dosTime, dosDate),
      compressionMethod: ZIP_METHOD_NAMES[method],
    })
    offset = nameStart + nameLength + extraLength + commentLength
  }
  return out
}

/** 顺序扫 tar 头部，返回条目元数据（跳过数据区）。 */
export function listTarEntries(tar: Uint8Array): ArchiveEntryMeta[] {
  const out: ArchiveEntryMeta[] = []
  const decoder = new TextDecoder()
  let offset = 0
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512)
    offset += 512
    let allZero = true
    for (const byte of header) {
      if (byte !== 0) {
        allZero = false
        break
      }
    }
    if (allZero) break

    const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '')
    const sizeText = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim()
    const mtimeText = decoder.decode(header.subarray(136, 148)).replace(/\0.*$/, '').trim()
    const typeFlag = String.fromCharCode(header[156] ?? 0)
    const prefix = decoder.decode(header.subarray(345, 500)).replace(/\0.*$/, '')
    const size = Number.parseInt(sizeText, 8) || 0
    const mtime = mtimeText ? Number.parseInt(mtimeText, 8) * 1000 : undefined
    const fullName = prefix ? `${prefix}/${name}` : name
    const isDirectory = typeFlag === '5' || fullName.endsWith('/')
    out.push({
      path: isDirectory ? fullName.replace(/\/+$/, '') : fullName,
      originalSize: isDirectory ? 0 : size,
      compressedSize: isDirectory ? 0 : size,
      isDirectory,
      mtime,
    })
    offset += Math.ceil(size / 512) * 512
  }
  return out
}

/** 根据格式列出归档条目；format 为 auto 时按魔数识别。 */
export function listArchiveEntries(
  bytes: Uint8Array,
  format: 'auto' | ArchiveCodecFormat,
): ArchiveListing {
  const detected = format === 'auto' ? detectArchiveFormat(bytes) : format
  if (detected === undefined) {
    throw new Error('无法识别的压缩包格式')
  }
  switch (detected) {
    case 'zip':
      return { format: 'zip', entries: listZipEntries(bytes) }
    case 'tar':
      return { format: 'tar', entries: listTarEntries(bytes) }
    case 'iso':
      return { format: 'iso', entries: listIsoEntries(bytes) }
    case 'gzip-tar': {
      let inflated: Uint8Array
      try {
        inflated = gunzipSync(bytes)
      } catch {
        inflated = bytes
      }
      const isTar =
        inflated.byteLength >= 262 &&
        inflated[257] === 0x75 &&
        inflated[258] === 0x73 &&
        inflated[259] === 0x74 &&
        inflated[260] === 0x61 &&
        inflated[261] === 0x72
      if (isTar) {
        return { format: 'gzip-tar', entries: listTarEntries(inflated) }
      }
      return {
        format: 'gzip-file',
        entries: [
          {
            path: 'data',
            originalSize: inflated.byteLength,
            compressedSize: bytes.byteLength,
            isDirectory: false,
            compressionMethod: 'gzip',
          },
        ],
      }
    }
    default:
      throw new Error('无法识别的压缩包格式')
  }
}
