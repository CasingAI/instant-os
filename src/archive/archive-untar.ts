/**
 * 极简 ustar/posix tar 解析（只提取普通文件；忽略硬链/设备等）。
 * npm tarball 通常为 gzip + 本格式。
 */
export function untarBytes(tar: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  let offset = 0
  const decoder = new TextDecoder()

  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512)
    offset += 512
    // 全零块 = 结束
    if (header.every((b) => b === 0)) break

    const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '')
    const sizeOctal = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim()
    const typeFlag = String.fromCharCode(header[156] ?? 0)
    const prefix = decoder.decode(header.subarray(345, 500)).replace(/\0.*$/, '')
    const size = Number.parseInt(sizeOctal, 8) || 0
    const fullName = prefix ? `${prefix}/${name}` : name

    if (typeFlag === '0' || typeFlag === '\0') {
      const data = tar.subarray(offset, offset + size)
      out[fullName] = data.slice()
    }
    // 数据按 512 对齐
    offset += Math.ceil(size / 512) * 512
  }

  return out
}
