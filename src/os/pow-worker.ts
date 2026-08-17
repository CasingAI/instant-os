/// <reference lib="webworker" />

/**
 * PoW 并行求解 worker：按 stride 切分 nonce 空间独立搜索。
 * 协议与主线程 pow-client.ts 完全一致（PBKDF2-HMAC-SHA-256 + POW_SALT），
 * 每个 worker 只负责 nonce = offset + k*stride 的序列，命中即回报。
 * 本文件仅被浏览器加载（vite `?worker` 静态导入），不参与 node 单测。
 */

const POW_SALT = 'instant-pow-v2'

export type PowWorkerRequest = {
  type: 'solve'
  /** 已拼好 challenge + '.' + bodyHash + '.' 前缀，worker 只追加 nonce */
  baseInput: string
  iters: number
  difficulty: number
  /** nonce 步长 = worker 总数 */
  stride: number
  /** 本 worker 的起始 nonce */
  offset: number
  maxNonce: number
}

export type PowWorkerResponse =
  | { type: 'found'; nonce: number; hash: string }
  | { type: 'done' }

/** hex 输出前导零 bit 数（与服务端一致） */
function leadingZeroBits(hex: string): number {
  let bits = 0
  for (const ch of hex) {
    const nibble = Number.parseInt(ch, 16)
    if (nibble === 0) {
      bits += 4
      continue
    }
    if ((nibble & 0x8) === 0) {
      bits++
    } else {
      break
    }
    if ((nibble & 0x4) === 0) {
      bits++
    } else {
      break
    }
    if ((nibble & 0x2) === 0) {
      bits++
    } else {
      break
    }
    if ((nibble & 0x1) === 0) {
      bits++
    }
    break
  }
  return bits
}

/** PBKDF2-HMAC-SHA-256 十六进制输出（与服务端同盐、同算法） */
async function pbkdf2Sha256Hex(input: string, iters: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(POW_SALT),
      iterations: iters,
      hash: 'SHA-256',
    },
    key,
    256,
  )
  const bytes = new Uint8Array(bits)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

function post(message: PowWorkerResponse): void {
  ;(self as unknown as Worker).postMessage(message)
}

self.onmessage = (event: MessageEvent<PowWorkerRequest>) => {
  const request = event.data
  if (request.type !== 'solve') return
  void (async () => {
    for (let nonce = request.offset; nonce < request.maxNonce; nonce += request.stride) {
      const hash = await pbkdf2Sha256Hex(`${request.baseInput}${nonce}`, request.iters)
      if (leadingZeroBits(hash) >= request.difficulty) {
        post({ type: 'found', nonce, hash })
        return
      }
    }
    post({ type: 'done' })
  })()
}
