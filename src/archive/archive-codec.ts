import { gzipSync, zipSync } from 'fflate'

/**
 * Archive Worker 与 node 测试共用的纯编解码函数。
 * 本模块不碰 VFS / Worker，可被 node --experimental-strip-types 直接加载。
 */

export type ArchiveCodecFormat = 'zip' | 'tar' | 'gzip-tar' | 'gzip-file'

const TAR_BLOCK_SIZE = 512
const TAR_MAX_PATH = 255

/** 魔数识别归档格式；无法识别返回 undefined。 */
export function detectArchiveFormat(
  bytes: Uint8Array,
): Exclude<ArchiveCodecFormat, 'gzip-file'> | undefined {
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  ) {
    return 'zip'
  }
  if (bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return 'gzip-tar'
  }
  if (
    bytes.byteLength >= 262 &&
    bytes[257] === 0x75 &&
    bytes[258] === 0x73 &&
    bytes[259] === 0x74 &&
    bytes[260] === 0x61 &&
    bytes[261] === 0x72
  ) {
    return 'tar'
  }
  return undefined
}

/** 复制为与内容等长的独立 ArrayBuffer（供 postMessage 转移；避免误转移共享大缓冲）。 */
export function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.slice().buffer
}

/** zip 打包（条目路径 → 字节）。 */
export function zipBytes(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files)
}

/** gzip 压缩（配合 tarBytes 组成 .tar.gz）。 */
export function gzipBytes(bytes: Uint8Array): Uint8Array {
  return gzipSync(bytes)
}

function writeOctalField(header: Uint8Array, offset: number, length: number, value: number): void {
  const digits = length - 1
  const encoded = value.toString(8).padStart(digits, '0').slice(-digits)
  for (let i = 0; i < digits; i++) {
    header[offset + i] = encoded.charCodeAt(i)
  }
  header[offset + digits] = 0 // NUL 结尾
}

function writeTextField(header: Uint8Array, offset: number, value: string): void {
  const encoded = new TextEncoder().encode(value)
  header.set(encoded.subarray(0, header.length - offset), offset)
}

/**
 * 极简 ustar 写入器（只写普通文件；与 archive-untar.ts 的解析能力对称）。
 * 路径超过 100 字符时拆进 prefix 字段；总长超 255 抛错。
 */
export function tarBytes(files: Record<string, Uint8Array>): Uint8Array {
  const blocks: Uint8Array[] = []

  for (const [rawPath, data] of Object.entries(files)) {
    const path = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\0/g, '')
    let name = path
    let prefix = ''
    if (name.length > 100) {
      const slash = name.lastIndexOf('/', 155)
      if (slash > 0 && name.length - (slash + 1) <= 100) {
        prefix = name.slice(0, slash)
        name = name.slice(slash + 1)
      } else {
        throw new Error(`tar 路径过长，无法写入 ustar 头: ${path}`)
      }
    }
    if (path.length > TAR_MAX_PATH) {
      throw new Error(`tar 路径过长，无法写入 ustar 头: ${path}`)
    }

    const header = new Uint8Array(TAR_BLOCK_SIZE)
    writeTextField(header, 0, name)
    writeTextField(header, 100, '0000644') // mode：rw-r--r--
    writeOctalField(header, 108, 8, 0) // uid
    writeOctalField(header, 116, 8, 0) // gid
    writeOctalField(header, 124, 12, data.byteLength) // size
    writeOctalField(header, 136, 12, 0) // mtime
    header[156] = 0x30 // typeflag：'0' 普通文件
    writeTextField(header, 257, 'ustar') // magic
    writeTextField(header, 263, '00') // version
    if (prefix) {
      writeTextField(header, 345, prefix)
    }

    // checksum：chksum 区先填空格，求和后写 6 位八进制 + NUL + 空格
    header.fill(0x20, 148, 156)
    const sum = header.reduce((acc, byte) => acc + byte, 0)
    const checksum = sum.toString(8).padStart(6, '0')
    for (let i = 0; i < 6; i++) {
      header[148 + i] = checksum.charCodeAt(i)
    }
    header[154] = 0
    header[155] = 0x20

    blocks.push(header)
    if (data.byteLength > 0) {
      blocks.push(data)
      const padding = TAR_BLOCK_SIZE - (data.byteLength % TAR_BLOCK_SIZE)
      if (padding !== TAR_BLOCK_SIZE) {
        blocks.push(new Uint8Array(padding))
      }
    }
  }

  // 结尾两个全零块
  blocks.push(new Uint8Array(TAR_BLOCK_SIZE * 2))

  const total = blocks.reduce((acc, block) => acc + block.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const block of blocks) {
    out.set(block, offset)
    offset += block.byteLength
  }
  return out
}
