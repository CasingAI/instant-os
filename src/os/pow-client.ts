import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { argon2id } from 'hash-wasm'

/**
 * 免费额度网关 PoW 客户端：与服务端 Instant-demo-api 协议一致。
 * 每次 AI 请求独立完成一次 Argon2id 工作量证明，网关无状态验证。
 */

export type PowArgonParams = {
  m: number
  t: number
  p: number
}

export type PowChallenge = {
  version: 1
  challenge: string
  expiresAt: number
  difficulty: number
  argon: PowArgonParams
}

export class PowError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'PowError'
    this.code = code
  }
}

const POW_SALT = 'instant-pow-v1'
const MAX_NONCE = 1_000_000
const POW_VERSION = '1'

let cachedChallenge: PowChallenge | undefined

export function clearPowChallengeCache(): void {
  cachedChallenge = undefined
}

export async function fetchPowChallenge(
  origin: string,
  signal?: AbortSignal,
): Promise<PowChallenge> {
  if (cachedChallenge && cachedChallenge.expiresAt * 1000 > Date.now()) {
    return cachedChallenge
  }
  const response = await fetch(`${origin}/pow/challenge`, { signal })
  if (!response.ok) {
    throw new PowError(
      `免费额度网关 challenge 获取失败（HTTP ${response.status}），请检查网关是否已部署`,
      'pow_challenge_failed',
    )
  }
  const data = (await response.json()) as Partial<PowChallenge>
  if (
    !data.challenge ||
    typeof data.difficulty !== 'number' ||
    typeof data.expiresAt !== 'number' ||
    !data.argon ||
    typeof data.argon.m !== 'number' ||
    typeof data.argon.t !== 'number' ||
    typeof data.argon.p !== 'number'
  ) {
    throw new PowError('免费额度网关返回了异常的 challenge 数据', 'pow_challenge_failed')
  }
  cachedChallenge = data as PowChallenge
  return cachedChallenge
}

/** hex 输出前导零 bit 数（与服务端一致） */
export function leadingZeroBits(hex: string): number {
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

/**
 * 为请求体求解 PoW 并返回需要附加的 X-Pow-* headers。
 * bodyHash 绑定请求体，防止一个 nonce 重放到其他请求。
 */
export async function solvePowForBody(
  origin: string,
  body: Uint8Array,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const bodyHash = bytesToHex(sha256(body))
  const challenge = await fetchPowChallenge(origin, signal)
  const { difficulty, argon } = challenge
  const input = (nonce: number) => `${challenge.challenge}.${bodyHash}.${nonce}`

  for (let nonce = 0; nonce < MAX_NONCE; nonce++) {
    if (signal?.aborted) {
      throw new PowError('Proof-of-Work 已取消', 'pow_aborted')
    }
    const hash = await argon2id({
      password: input(nonce),
      salt: POW_SALT,
      iterations: argon.t,
      memorySize: argon.m,
      parallelism: argon.p,
      hashLength: 32,
      outputType: 'hex',
    })
    if (leadingZeroBits(hash) >= difficulty) {
      return {
        'X-Pow-Version': POW_VERSION,
        'X-Pow-Challenge': challenge.challenge,
        'X-Pow-Nonce': String(nonce),
        'X-Pow-Body-Hash': bodyHash,
      }
    }
  }
  throw new PowError('Proof-of-Work 未能在限次内求解，请重试', 'pow_failed')
}

/**
 * 把请求体读成可重放的 Uint8Array（转发与哈希共用同一份字节）。
 * 返回 undefined 表示无法可靠重放（如 FormData 的 multipart boundary 会变化），
 * 此时上层不应注入 PoW。
 */
export async function readBodyBytes(
  init?: RequestInit,
): Promise<Uint8Array | undefined> {
  const body = init?.body
  if (body === undefined || body === null) {
    return undefined
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body)
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer())
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString())
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // FormData 序列化会重新生成 multipart boundary，无法与原始 content-type 对齐
    return undefined
  }
  if (body instanceof ReadableStream) {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      chunks.push(value)
      total += value.length
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return merged
  }
  return undefined
}
