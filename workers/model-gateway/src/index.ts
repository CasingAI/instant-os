import { lookupModelObject } from './catalog.ts'
import { isOriginAllowed } from './cors.ts'
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_PBKDF2_ITERS,
  DEFAULT_WINDOW_SECONDS,
  issueChallenge,
  parseChallenge,
  sha256HexBytes,
  verifyChallenge,
  verifyPowWork,
} from './pow.ts'

export interface Env {
  MODELS: R2Bucket
  POW_SECRET: string
  DIFFICULTY?: string
  POW_ITERS?: string
  POW_WINDOW_SECONDS?: string
  ENVIRONMENT?: string
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, X-Pow-Version, X-Pow-Challenge, X-Pow-Nonce, X-Pow-Body-Hash',
  'Access-Control-Expose-Headers':
    'Content-Type, Content-Length, Content-Encoding, ETag, X-Linked-Size',
  'Access-Control-Max-Age': '86400',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')
    if (!origin || !isOriginAllowed(origin)) {
      return json({ error: '来源域不在白名单', code: 'origin_not_allowed' }, 403)
    }

    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }), origin)
    }

    try {
      if (url.pathname === '/' && request.method === 'GET') {
        return cors(json({ ok: true, service: 'instant-app-models' }), origin)
      }
      if (url.pathname === '/pow/challenge') {
        return await handleChallenge(request, env, origin)
      }
      if (url.pathname.startsWith('/assets/')) {
        return await handleObject(request, env, origin, url.pathname)
      }
      return cors(json({ error: '未找到', code: 'not_found' }, 404), origin)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'internal error'
      return cors(json({ error: message }, 500), origin)
    }
  },
}

async function handleChallenge(
  request: Request,
  env: Env,
  origin: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return cors(
      json(
        {
          error: '仅支持 POST',
          code: 'method_not_allowed',
          reason: 'challenge 需携带将要 GET 的路径字节以绑定 bodyHash',
        },
        405,
      ),
      origin,
    )
  }
  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength === 0 || body.byteLength > 1024) {
    return cors(json({ error: 'challenge 路径无效', code: 'bad_path' }, 400), origin)
  }
  const pathname = new TextDecoder().decode(body)
  if (!lookupModelObject(pathname)) {
    return cors(json({ error: '未知模型路径', code: 'unknown_path' }, 404), origin)
  }
  const bodyHash = await sha256HexBytes(body)
  const result = await issueChallenge(env.POW_SECRET, bodyHash, powOptions(env))
  return cors(json(result), origin)
}

async function handleObject(
  request: Request,
  env: Env,
  origin: string,
  pathname: string,
): Promise<Response> {
  if (request.method !== 'GET') {
    return cors(json({ error: '仅支持 GET', code: 'method_not_allowed' }, 405), origin)
  }

  const object = lookupModelObject(pathname)
  if (!object) {
    return cors(json({ error: '未知模型路径', code: 'unknown_path' }, 404), origin)
  }

  const proof = readProofHeaders(request.headers)
  if (!proof) {
    return cors(json({ error: '缺少 Proof-of-Work 凭证', code: 'pow_required' }, 401), origin)
  }

  const pathHash = await sha256HexBytes(new TextEncoder().encode(pathname))
  if (pathHash !== proof.bodyHash.toLowerCase()) {
    return cors(json({ error: '路径哈希不匹配', code: 'body_hash_mismatch' }, 401), origin)
  }

  const challengeCheck = await verifyChallenge(env.POW_SECRET, proof.challenge, pathHash, {
    windowSeconds: powOptions(env).windowSeconds,
  })
  if (!challengeCheck.ok) {
    return cors(
      json({ error: `challenge 无效：${challengeCheck.reason}`, code: 'bad_challenge' }, 401),
      origin,
    )
  }

  const parts = parseChallenge(proof.challenge)
  if (!parts) {
    return cors(json({ error: 'challenge 无法解析', code: 'bad_challenge' }, 401), origin)
  }

  const nonce = Number(proof.nonce)
  const workCheck = await verifyPowWork({
    challenge: proof.challenge,
    bodyHash: proof.bodyHash,
    nonce,
    difficulty: parts.difficulty,
    iters: parts.iters,
  })
  if (!workCheck.ok) {
    return cors(
      json({ error: `工作量不足：${workCheck.reason}`, code: 'insufficient_work' }, 401),
      origin,
    )
  }

  const stored = await env.MODELS.get(object.r2Key)
  if (!stored) {
    return cors(json({ error: '对象不存在', code: 'not_found' }, 404), origin)
  }

  const headers = new Headers()
  const contentType = stored.httpMetadata?.contentType ?? 'application/octet-stream'
  const contentEncoding = stored.httpMetadata?.contentEncoding ?? 'gzip'
  headers.set('Content-Type', contentType)
  headers.set('Content-Encoding', contentEncoding)
  headers.set('ETag', stored.httpEtag)
  headers.set('Content-Length', String(stored.size))
  headers.set('X-Linked-Size', String(object.uncompressedBytes))
  headers.set('Cache-Control', 'private, max-age=31536000, immutable, no-transform')
  applyCors(headers, origin)

  return new Response(stored.body, {
    status: 200,
    headers,
    encodeBody: 'manual',
  })
}

function powOptions(env: Env): {
  difficulty: number
  iters: number
  windowSeconds: number
} {
  return {
    difficulty: numberFromEnv(env.DIFFICULTY, DEFAULT_DIFFICULTY),
    iters: numberFromEnv(env.POW_ITERS, DEFAULT_PBKDF2_ITERS),
    windowSeconds: numberFromEnv(env.POW_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
  }
}

function numberFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readProofHeaders(headers: Headers): {
  challenge: string
  nonce: string
  bodyHash: string
} | null {
  if (headers.get('x-pow-version') !== '3') return null
  const challenge = headers.get('x-pow-challenge')
  const nonce = headers.get('x-pow-nonce')
  const bodyHash = headers.get('x-pow-body-hash')
  if (!challenge || nonce === null || !bodyHash) return null
  return { challenge, nonce, bodyHash }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function applyCors(headers: Headers, origin: string): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value)
  }
  headers.set('Access-Control-Allow-Origin', origin)
}

function cors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers)
  applyCors(headers, origin)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
