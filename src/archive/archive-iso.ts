import { ISOReader, ISOWriter } from './vendor/iso9660/src/index.js'
import type { ArchiveEntryMeta } from './archive-list.ts'

/**
 * ISO 9660 光盘镜像编解码（引擎：vendor/iso9660，纯 JS 同步接口）。
 * 与 archive-unzip / archive-untar 同层：不碰 VFS / Worker，可被 node 直接加载。
 * 读走 PVD + Joliet 自动识别（中文长文件名靠 Joliet 树）；
 * 写只能从零构建整盘 —— 「编辑已有 ISO」由上层 rewrite 模式全量重建。
 */

const CD001_OFFSET = 0x8001 // sector 16 的 magic 字段

/** 魔数识别：偏移 0x8001 起 5 字节为 "CD001"；判定优先于扩展名。 */
export function isIsoImageBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < CD001_OFFSET + 5) return false
  return (
    bytes[CD001_OFFSET] === 0x43 &&
    bytes[CD001_OFFSET + 1] === 0x44 &&
    bytes[CD001_OFFSET + 2] === 0x30 &&
    bytes[CD001_OFFSET + 3] === 0x30 &&
    bytes[CD001_OFFSET + 4] === 0x31
  )
}

/** 复制出与视图内容等长的独立 ArrayBuffer（ISOReader 构造只认整体 buffer）。 */
function toExactBuffer(bytes: Uint8Array): ArrayBufferLike {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer
  }
  return bytes.slice().buffer
}

function stripLeadingSlash(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}

/** 解出全部文件（相对路径 → 字节）；目录不产出条目（上层按路径前缀推导）。 */
export function unisoBytes(input: Uint8Array): Map<string, Uint8Array> {
  const reader = new ISOReader(toExactBuffer(input))
  const entries = reader.list({ stat: true })
  const out = new Map<string, Uint8Array>()
  for (const entry of entries) {
    out.set(stripLeadingSlash(entry.path), reader.read(entry.path))
  }
  return out
}

/** 列条目元数据；ISO 无压缩层，压缩后大小等于原始大小。 */
export function listIsoEntries(input: Uint8Array): ArchiveEntryMeta[] {
  const reader = new ISOReader(toExactBuffer(input))
  const entries = reader.list({ stat: true })
  return entries.map((entry) => ({
    path: stripLeadingSlash(entry.path),
    originalSize: entry.size,
    compressedSize: entry.size,
    isDirectory: false,
    mtime: entry.date?.getTime(),
  }))
}

/**
 * 从零构建数据镜像（Joliet 默认开启）。
 * 库的硬限制：目录深度 ≤ 8、单文件 ≤ 4 GiB、重复路径抛错。
 */
export function isoBytes(
  files: Record<string, Uint8Array>,
  opts?: { volumeId?: string },
): Uint8Array {
  const writer = new ISOWriter({ volumeId: sanitizeVolumeId(opts?.volumeId) })
  for (const [rawPath, data] of Object.entries(files)) {
    const path = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\0/g, '')
    if (!path) throw new Error(`无效的镜像内路径: ${rawPath}`)
    writer.add(path, data)
  }
  return writer.toUint8Array()
}

/** 卷标识只允许 A-Z 0-9 _ - 且 ≤32 字符；空值回落 UNTITLED。 */
function sanitizeVolumeId(value: string | undefined): string {
  const cleaned = (value ?? '').toUpperCase().replace(/[^A-Z0-9_.\-]/g, '_').slice(0, 32)
    .replace(/^_+|_+$/g, '')
  return cleaned || 'UNTITLED'
}
