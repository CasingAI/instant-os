/**
 * PoW 客户端单测（node --experimental-strip-types 直接跑）。
 *
 * 并行路径依赖 vite `?worker` 静态导入，node 下不可解析，
 * 这里只测纯串行路径与模式分发的可观测行为：
 * - leadingZeroBits 正确性（与服务端同算法）
 * - setPowSolverConfig 切换串行/并行，并行动态 import 失败时降级串行
 * - abort 语义
 */
import assert from 'node:assert/strict'
import {
  clearPowChallengeCache,
  fetchPowChallenge,
  getPowSolverConfig,
  leadingZeroBits,
  PowError,
  readBodyBytes,
  setPowSolverConfig,
  solvePowForBody,
} from './pow-client.ts'

/** 极小难度：保证少量 nonce 内命中，测试足够快 */
const TEST_DIFFICULTY = 4
const TEST_ITERS = 64

function challengeResponse(overrides?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      version: 2,
      challenge: 'v2.2000000000.4.64.deadbeef',
      expiresAt: 4102444800, // 2099-01-01，永不失效
      difficulty: TEST_DIFFICULTY,
      iters: TEST_ITERS,
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

async function solveWithFixedChallenge(
  mode: 'sequential' | 'parallel',
): Promise<Record<string, string>> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() =>
    Promise.resolve(
      challengeResponse(),
    )) as unknown as typeof fetch
  setPowSolverConfig({ mode })
  clearPowChallengeCache()
  try {
    return await solvePowForBody('http://gateway.test', new TextEncoder().encode('hello'))
  } finally {
    globalThis.fetch = originalFetch
    clearPowChallengeCache()
  }
}

{
  // leadingZeroBits 边界：已知 hex 的前导零 bit 数
  assert.equal(leadingZeroBits('0000abcd'), 16)
  assert.equal(leadingZeroBits('0abcd'), 4)
  assert.equal(leadingZeroBits('abcd'), 0)
  assert.equal(leadingZeroBits('0f'), 4)
  assert.equal(leadingZeroBits('ff'), 0)
}

{
  // 串行模式：求解成功，nonce 满足难度，header 齐备
  const headers = await solveWithFixedChallenge('sequential')
  const nonce = Number(headers['X-Pow-Nonce'])
  assert.ok(Number.isInteger(nonce) && nonce >= 0, 'nonce 应为非负整数')
  assert.equal(headers['X-Pow-Version'], '2')
  assert.match(headers['X-Pow-Challenge'], /^v2\./)
  assert.equal(headers['X-Pow-Body-Hash'], '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
}

{
  // 并行模式：node 下动态 import ?worker 失败 → 自动降级串行，结果等价
  const headers = await solveWithFixedChallenge('parallel')
  assert.equal(headers['X-Pow-Version'], '2')
  assert.match(headers['X-Pow-Challenge'], /^v2\./)
  const nonce = Number(headers['X-Pow-Nonce'])
  assert.ok(Number.isInteger(nonce) && nonce >= 0)
}

{
  // 默认配置为并行
  assert.equal(getPowSolverConfig().mode, 'parallel')
}

{
  // fetch 失败（网络/未部署）→ pow_challenge_failed
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.resolve(new Response('', { status: 503 }))) as unknown as typeof fetch
  clearPowChallengeCache()
  try {
    await assert.rejects(
      () => solvePowForBody('http://gateway.test', new TextEncoder().encode('x')),
      (error: unknown) => error instanceof PowError && error.code === 'pow_challenge_failed',
    )
  } finally {
    globalThis.fetch = originalFetch
    clearPowChallengeCache()
  }
}

{
  // 提前 abort → pow_aborted（串行路径）
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () =>
      solveWithAbort(controller.signal),
    (error: unknown) => error instanceof PowError && error.code === 'pow_aborted',
  )
}

async function solveWithAbort(signal: AbortSignal): Promise<Record<string, string>> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.resolve(challengeResponse())) as unknown as typeof fetch
  setPowSolverConfig({ mode: 'sequential' })
  clearPowChallengeCache()
  try {
    return await solvePowForBody('http://gateway.test', new TextEncoder().encode('x'), signal)
  } finally {
    globalThis.fetch = originalFetch
    clearPowChallengeCache()
  }
}

{
  // challenge 缓存：同源未过期复用，不发第二次 fetch
  let fetchCount = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((() => {
    fetchCount += 1
    return Promise.resolve(challengeResponse())
  }) as unknown) as typeof fetch
  setPowSolverConfig({ mode: 'sequential' })
  clearPowChallengeCache()
  try {
    await solvePowForBody('http://gateway.test', new TextEncoder().encode('a'))
    await solvePowForBody('http://gateway.test', new TextEncoder().encode('b'))
    assert.equal(fetchCount, 1, '第二次请求应复用缓存的 challenge')
  } finally {
    globalThis.fetch = originalFetch
    clearPowChallengeCache()
  }
}

{
  // readBodyBytes：字符串 / ArrayBuffer / Uint8Array / ReadableStream
  const text = await readBodyBytes({ body: 'hello' })
  assert.equal(new TextDecoder().decode(text), 'hello')
  const buf = await readBodyBytes({ body: new Uint8Array([1, 2, 3]).buffer })
  assert.deepEqual([...buf!], [1, 2, 3])
  const view = await readBodyBytes({ body: new Uint8Array([9, 8, 7]) })
  assert.deepEqual([...view!], [9, 8, 7])
  const stream = await readBodyBytes({
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('str'))
        controller.close()
      },
    }),
  })
  assert.equal(new TextDecoder().decode(stream), 'str')
  assert.equal(await readBodyBytes({ body: undefined }), undefined)
}

// 复位默认配置，避免影响其他测试
setPowSolverConfig({ mode: 'parallel' })

console.log('pow-client 单测通过')
