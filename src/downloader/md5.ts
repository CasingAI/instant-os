/**
 * 纯 TS 的 MD5 实现。
 * Web Crypto 不支持 MD5，而 Metalink 文件常带 md5 哈希，这里自行实现用于校验。
 */

const SHIFT_TABLE = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

const K_TABLE: number[] = []
for (let i = 0; i < 64; i += 1) {
  K_TABLE[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32)
}

function rotateLeft(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n))
}

/** 计算字节的 MD5，返回小写 hex。 */
export function md5Hex(input: Uint8Array): string {
  const bitLength = input.byteLength * 8
  const paddedLength = (((input.byteLength + 8) >> 6) + 1) << 6
  const buffer = new Uint8Array(paddedLength)
  buffer.set(input)
  buffer[input.byteLength] = 0x80
  const view = new DataView(buffer.buffer)
  view.setUint32(paddedLength - 8, bitLength >>> 0, true)
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 2 ** 32), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const m: number[] = []
    for (let i = 0; i < 16; i += 1) {
      m[i] = view.getUint32(offset + i * 4, true)
    }
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i += 1) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const tmp = d
      d = c
      c = b
      b = (b + rotateLeft((a + f + K_TABLE[i]! + m[g]!) | 0, SHIFT_TABLE[i]!)) | 0
      a = tmp
    }
    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }

  const digest = new Uint8Array(16)
  const digestView = new DataView(digest.buffer)
  digestView.setUint32(0, a0, true)
  digestView.setUint32(4, b0, true)
  digestView.setUint32(8, c0, true)
  digestView.setUint32(12, d0, true)
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
