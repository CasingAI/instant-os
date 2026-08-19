import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  beginPowProgress,
  endPowProgress,
  reportPowProgress,
} from './pow-progress-store.ts'

export type { PowProgressState } from './pow-progress-store.ts'

export { getPowProgress, subscribePowProgress } from './pow-progress-store.ts'

/**
 * 免费额度网关 PoW 客户端：与服务端 Instant-demo-api 协议一致（PBKDF2 v3）。
 * 每次 AI 请求都先 POST 完整请求体到 `/pow/challenge`，服务端据此签发与
 * bodyHash 绑定的 challenge，随后客户端用同一请求体请求 completion 并被校验。
 */

export type PowChallenge = {
  version: 3
  challenge: string
  expiresAt: number
  difficulty: number
  iters: number
  bodyHash: string
}

export class PowError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'PowError'
    this.code = code
  }
}

const POW_SALT = 'instant-pow-v3'
const MAX_NONCE = 1_000_000
const POW_VERSION = '3'

export type PowSolverMode = 'sequential' | 'parallel'

export type PowSolverConfig = {
  /** 求解模式；默认 parallel（Web Worker 并行，失败自动降级串行） */
  mode: PowSolverMode
}

let solverConfig: PowSolverConfig = { mode: 'parallel' }

export function setPowSolverConfig(config: PowSolverConfig): void {
  solverConfig = config
}

export function getPowSolverConfig(): PowSolverConfig {
  return solverConfig
}

/**
 * 请求一次与该请求体绑定的 challenge：POST 完整 body 到 `/pow/challenge`，
 * 服务端以其 SHA-256 签发 challenge，保证一个 challenge 只能用于一个请求。
 * 每次调用都是一次独立获取，不做全局缓存。
 */
export async function fetchPowChallenge(
  origin: string,
  body: Uint8Array,
  signal?: AbortSignal,
): Promise<PowChallenge> {
  const response = await fetch(`${origin}/pow/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: new Blob([body as unknown as BlobPart]),
    signal,
  })
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
    typeof data.iters !== 'number'
  ) {
    throw new PowError('免费额度网关返回了异常的 challenge 数据', 'pow_challenge_failed')
  }
  return data as PowChallenge
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
  return bytesToHex(new Uint8Array(bits))
}

/**
 * 串行求解：逐 nonce 试错（并行失败时的保底路径）。
 */
async function solveSequential(
  input: (nonce: number) => string,
  difficulty: number,
  iters: number,
  signal?: AbortSignal,
): Promise<number> {
  for (let nonce = 0; nonce < MAX_NONCE; nonce++) {
    if (signal?.aborted) {
      throw new PowError('Proof-of-Work 已取消', 'pow_aborted')
    }
    const hash = await pbkdf2Sha256Hex(input(nonce), iters)
    // 每 512 次上报一次，避免频繁驱动 UI
    if (nonce % 512 === 0) {
      reportPowProgress(nonce + 1, MAX_NONCE)
    }
    if (leadingZeroBits(hash) >= difficulty) {
      return nonce
    }
  }
  throw new PowError('Proof-of-Work 未能在限次内求解，请重试', 'pow_failed')
}

/**
 * 并行求解（Web Worker）。worker 模块含 `?worker` 静态导入，
 * 只能被浏览器加载，因此这里惰性动态 import；node 单测仅执行串行路径。
 * worker 不可用时由客户端置 workerDisabled，此后本进程内永久降级串行。
 */
async function solveParallel(
  baseInput: string,
  difficulty: number,
  iters: number,
  signal?: AbortSignal,
): Promise<number> {
  try {
    const { solvePowParallel } = await import('./pow-worker-client.ts')
    const result = await solvePowParallel(
      baseInput,
      iters,
      difficulty,
      MAX_NONCE,
      signal,
      (tried) => reportPowProgress(tried, MAX_NONCE),
    )
    return result.nonce
  } catch (error) {
    if (error instanceof PowError) {
      throw error
    }
    if (error instanceof Error && error.message === 'not-found') {
      throw new PowError('Proof-of-Work 未能在限次内求解，请重试', 'pow_failed')
    }
    if (signal?.aborted) {
      throw new PowError('Proof-of-Work 已取消', 'pow_aborted')
    }
    // worker 创建失败 / 运行错误 → 本次降级串行重试；workerDisabled 已由客户端置位
    return solveSequential((nonce) => `${baseInput}${nonce}`, difficulty, iters, signal)
  }
}

/**
 * 为请求体求解 PoW 并返回需要附加的 X-Pow-* headers。
 * bodyHash 绑定请求体，防止一个 nonce 重放到其他请求。
 */
export async function solvePowForBody(
  origin: string,
  body: Uint8Array,
  signal?: AbortSignal,
  mode: PowSolverMode = solverConfig.mode,
): Promise<Record<string, string>> {
  beginPowProgress(MAX_NONCE)
  try {
    const bodyHash = bytesToHex(sha256(body))
    const challenge = await fetchPowChallenge(origin, body, signal)
    const { difficulty, iters } = challenge
    const baseInput = `${challenge.challenge}.${bodyHash}.`

    const nonce =
      mode === 'parallel'
        ? await solveParallel(baseInput, difficulty, iters, signal)
        : await solveSequential(
            (nonce) => `${baseInput}${nonce}`,
            difficulty,
            iters,
            signal,
          )

    return {
      'X-Pow-Version': POW_VERSION,
      'X-Pow-Challenge': challenge.challenge,
      'X-Pow-Nonce': String(nonce),
      'X-Pow-Body-Hash': bodyHash,
    }
  } finally {
    endPowProgress()
  }
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
