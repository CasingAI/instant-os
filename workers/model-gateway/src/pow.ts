/**
 * 无状态 PoW（PBKDF2-HMAC-SHA-256 v3）。
 * 线协议与 Instant-demo-api / instant-app `pow-client.ts` 一致，便于浏览器直接复用客户端。
 * 本 Worker 只签发 / 验算；求解在浏览器。
 *
 * challenge: v3.{ts}.{difficulty}.{iters}.{bodyHash}.{sig}
 * sig = HMAC-SHA256(POW_SECRET, "v3:{ts}:{difficulty}:{iters}:{bodyHash}")
 */

export const POW_PROTOCOL_VERSION = 3
export const POW_SALT = 'instant-pow-v3'
export const DEFAULT_DIFFICULTY = 6
export const DEFAULT_PBKDF2_ITERS = 1024
export const DEFAULT_WINDOW_SECONDS = 120
export const MAX_NONCE = 1_000_000

const BODY_HASH_RE = /^[0-9a-fA-F]{64}$/
const CHALLENGE_RE =
  /^v3\.(\d{1,12})\.(\d{1,3})\.(\d{1,8})\.([0-9a-fA-F]{64})\.([0-9a-fA-F]{64})$/

export type ChallengeParts = {
  version: 3
  ts: number
  difficulty: number
  iters: number
  bodyHash: string
  sig: string
}

export type ChallengeResult = {
  version: 3
  challenge: string
  expiresAt: number
  difficulty: number
  iters: number
  bodyHash: string
}

export type VerifyResult = { ok: true } | { ok: false; reason: string }

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0')
  }
  return out
}

export function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export function signatureMessage(parts: {
  ts: number
  difficulty: number
  iters: number
  bodyHash: string
}): string {
  return `v3:${parts.ts}:${parts.difficulty}:${parts.iters}:${parts.bodyHash}`
}

export function serializeChallenge(parts: ChallengeParts): string {
  return `v3.${parts.ts}.${parts.difficulty}.${parts.iters}.${parts.bodyHash}.${parts.sig}`
}

export function parseChallenge(challenge: string): ChallengeParts | null {
  const match = CHALLENGE_RE.exec(challenge)
  if (!match) return null
  const [, tsStr, diffStr, itersStr, bodyHash, sig] = match
  const ts = Number(tsStr)
  const difficulty = Number(diffStr)
  const iters = Number(itersStr)
  if (
    !Number.isSafeInteger(ts) ||
    ts <= 0 ||
    !Number.isInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > 256 ||
    !Number.isInteger(iters) ||
    iters < 1 ||
    iters > 1_000_000 ||
    !BODY_HASH_RE.test(bodyHash!)
  ) {
    return null
  }
  return {
    version: 3,
    ts,
    difficulty,
    iters,
    bodyHash: bodyHash!.toLowerCase(),
    sig: sig!.toLowerCase(),
  }
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return bytesToHex(new Uint8Array(sig))
}

export async function sha256HexBytes(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}

export async function pbkdf2Sha256Hex(input: string, iterations: number): Promise<string> {
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
      iterations,
      hash: 'SHA-256',
    },
    key,
    256,
  )
  return bytesToHex(new Uint8Array(bits))
}

export async function issueChallenge(
  secret: string,
  bodyHash: string,
  options: {
    difficulty?: number
    iters?: number
    windowSeconds?: number
    now?: number
  } = {},
): Promise<ChallengeResult> {
  if (!BODY_HASH_RE.test(bodyHash)) {
    throw new Error('pow: invalid bodyHash')
  }
  const difficulty = options.difficulty ?? DEFAULT_DIFFICULTY
  const iters = options.iters ?? DEFAULT_PBKDF2_ITERS
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS
  const ts = Math.floor((options.now ?? Date.now()) / 1000)
  const normalized = bodyHash.toLowerCase()
  const msg = signatureMessage({ ts, difficulty, iters, bodyHash: normalized })
  const sig = await hmacSha256Hex(secret, msg)
  return {
    version: POW_PROTOCOL_VERSION,
    challenge: serializeChallenge({
      version: 3,
      ts,
      difficulty,
      iters,
      bodyHash: normalized,
      sig,
    }),
    expiresAt: ts + windowSeconds,
    difficulty,
    iters,
    bodyHash: normalized,
  }
}

export async function verifyChallenge(
  secret: string,
  challenge: string,
  bodyHash: string,
  options: { now?: number; windowSeconds?: number } = {},
): Promise<VerifyResult> {
  const parsed = parseChallenge(challenge)
  if (!parsed) return { ok: false, reason: 'malformed-challenge' }
  if (parsed.bodyHash !== bodyHash.toLowerCase()) {
    return { ok: false, reason: 'body-hash-mismatch' }
  }
  const nowSec = Math.floor((options.now ?? Date.now()) / 1000)
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS
  if (Math.abs(nowSec - parsed.ts) > windowSeconds) {
    return { ok: false, reason: 'expired' }
  }
  const expected = await hmacSha256Hex(secret, signatureMessage(parsed))
  if (!constantTimeHexEqual(expected, parsed.sig)) {
    return { ok: false, reason: 'bad-signature' }
  }
  return { ok: true }
}

export function leadingZeroBits(hex: string): number {
  let bits = 0
  for (const ch of hex) {
    const nibble = Number.parseInt(ch, 16)
    if (nibble === 0) {
      bits += 4
      continue
    }
    if ((nibble & 0x8) === 0) bits++
    else break
    if ((nibble & 0x4) === 0) bits++
    else break
    if ((nibble & 0x2) === 0) bits++
    else break
    if ((nibble & 0x1) === 0) bits++
    break
  }
  return bits
}

export function powInput(challenge: string, bodyHash: string, nonce: number): string {
  return `${challenge}.${bodyHash}.${nonce}`
}

export async function verifyPowWork(options: {
  challenge: string
  bodyHash: string
  nonce: number
  difficulty: number
  iters: number
}): Promise<VerifyResult> {
  if (!Number.isSafeInteger(options.nonce) || options.nonce < 0 || options.nonce > MAX_NONCE) {
    return { ok: false, reason: 'bad-nonce' }
  }
  const hash = await pbkdf2Sha256Hex(
    powInput(options.challenge, options.bodyHash, options.nonce),
    options.iters,
  )
  if (leadingZeroBits(hash) < options.difficulty) {
    return { ok: false, reason: 'insufficient-work' }
  }
  return { ok: true }
}
