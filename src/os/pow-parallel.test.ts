/**
 * PoW 并行求解核心单测（node --experimental-strip-types 直接跑）。
 *
 * pow-parallel.ts 是纯协调逻辑（worker 由外部注入），这里用模拟 Worker
 * 复刻 pow-worker.ts 的真实求解行为（PBKDF2 + leadingZeroBits），
 * 端到端验证 stride 切分 / found / done / abort / not-found 语义。
 */
import assert from 'node:assert/strict'
import {
  solvePowParallel,
  type PowWorkerRequest,
  type PowWorkerResponse,
} from './pow-parallel.ts'
import { leadingZeroBits } from './pow-client.ts'

const POW_SALT = 'instant-pow-v2'
const TEST_ITERS = 64
const TEST_DIFFICULTY = 8
const MAX_NONCE = 1_000_000
/** not-found 场景：只搜前 32 个 nonce，且该区间内无解（见下方扫描断言） */
const TINY_NONCE = 32

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

/**
 * 模拟真实 pow-worker.ts 的 Worker：收到 solve 请求后按 stride 搜索，
 * 命中 post found，区间搜完 post done。可用 flag 强制崩溃（fire error）。
 */
class MockPowWorker implements Worker {
  terminated = false
  private listeners = new Map<string, Set<(event: unknown) => void>>()
  private receivedRequests: PowWorkerRequest[] = []
  /** 置 true 时每个请求直接 fire error（模拟 worker 崩溃） */
  crashOnRequest = false
  /** 置 true 时命中后不回复（模拟挂起） */
  hang = false
  onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null
  onerror: ((this: Worker, ev: ErrorEvent) => unknown) | null = null
  onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener as (event: unknown) => void)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener as (event: unknown) => void)
  }

  dispatchEvent(_event: Event): boolean {
    return true
  }

  postMessage(message: PowWorkerRequest): void {
    if (this.terminated) return
    this.receivedRequests.push(message)
    if (this.crashOnRequest) {
      queueMicrotask(() => this.fireError('mock crash'))
      return
    }
    void this.runSolve(message)
  }

  terminate(): void {
    this.terminated = true
  }

  private async runSolve(request: PowWorkerRequest): Promise<void> {
    for (let nonce = request.offset; nonce < request.maxNonce; nonce += request.stride) {
      if (this.terminated) return
      const hash = await pbkdf2Sha256Hex(`${request.baseInput}${nonce}`, request.iters)
      if (leadingZeroBits(hash) >= request.difficulty) {
        if (this.hang) return
        this.fireMessage({ type: 'found', nonce, hash })
        return
      }
    }
    if (this.hang) return
    this.fireMessage({ type: 'done' })
  }

  private fireMessage(data: PowWorkerResponse): void {
    for (const listener of this.listeners.get('message') ?? []) {
      ;(listener as (event: MessageEvent<PowWorkerResponse>) => void)({
        data,
      } as MessageEvent<PowWorkerResponse>)
    }
    this.onmessage?.({ data } as MessageEvent<PowWorkerResponse>)
  }

  private fireError(message: string): void {
    for (const listener of this.listeners.get('error') ?? []) {
      ;(listener as (event: ErrorEvent) => void)({ message } as ErrorEvent)
    }
    this.onerror?.({ message } as ErrorEvent)
  }
}

function makeWorkers(count: number): MockPowWorker[] {
  return Array.from({ length: count }, () => new MockPowWorker())
}

const BASE_INPUT = 'v2.2000000000.8.64.sig.abcdef1234567890'

{
  // 并行求解：返回的 nonce 满足难度，且确实属于某个 worker 的 stride 子集
  const workers = makeWorkers(4)
  const result = await solvePowParallel(
    BASE_INPUT,
    TEST_ITERS,
    TEST_DIFFICULTY,
    MAX_NONCE,
    workers,
  )
  assert.ok(Number.isInteger(result.nonce) && result.nonce >= 0)
  const hash = await pbkdf2Sha256Hex(`${BASE_INPUT}${result.nonce}`, TEST_ITERS)
  assert.ok(leadingZeroBits(hash) >= TEST_DIFFICULTY, '返回的 nonce 必须满足难度')
  // 命中后其余 worker 被 terminate
  assert.ok(workers.every((w) => w.terminated), 'settle 后所有 worker 应被终止')
}

{
  // stride 切分正确：每个 worker 收到 offset=i / stride=count
  const workers = makeWorkers(3)
  const { solvePowParallel: solveWithCollect } = await import('./pow-parallel.ts')
  void solveWithCollect
  // 手动走一遍核心以捕获请求
  const requests: PowWorkerRequest[] = []
  const originalPost = workers[0].postMessage.bind(workers[0])
  workers[0].postMessage = (message: PowWorkerRequest) => {
    requests.push(message)
    originalPost(message)
  }
  const originalPost2 = workers[1].postMessage.bind(workers[1])
  workers[1].postMessage = (message: PowWorkerRequest) => {
    requests.push(message)
    originalPost2(message)
  }
  const originalPost3 = workers[2].postMessage.bind(workers[2])
  workers[2].postMessage = (message: PowWorkerRequest) => {
    requests.push(message)
    originalPost3(message)
  }
  await solvePowParallel(
    BASE_INPUT,
    TEST_ITERS,
    TEST_DIFFICULTY,
    MAX_NONCE,
    workers,
  )
  assert.equal(requests.length, 3)
  const offsets = requests.map((r) => r.offset).sort((a, b) => a - b)
  assert.deepEqual(offsets, [0, 1, 2], 'offset 应覆盖 0..count-1')
  for (const r of requests) {
    assert.equal(r.stride, 3)
    assert.equal(r.maxNonce, MAX_NONCE)
    assert.equal(r.baseInput, BASE_INPUT)
  }
}

{
  // 全部区间搜完仍无解 → not-found
  // 先扫描确认前 32 个 nonce 在 difficulty=20 下确实无解
  let hasSolution = false
  for (let i = 0; i < TINY_NONCE; i++) {
    const h = await pbkdf2Sha256Hex(`${BASE_INPUT}${i}`, TEST_ITERS)
    if (leadingZeroBits(h) >= 20) {
      hasSolution = true
      break
    }
  }
  assert.equal(hasSolution, false, '前 32 个 nonce 不应满足 difficulty=20')

  const workers = makeWorkers(2)
  await assert.rejects(
    () =>
      solvePowParallel(
        BASE_INPUT,
        TEST_ITERS,
        20, // 前 32 个 nonce 不可能满足
        TINY_NONCE,
        workers,
      ),
    (error: unknown) => error instanceof Error && error.message === 'not-found',
  )
}

{
  // 任一 worker error → reject（不置永久禁用位，由客户端决定降级）
  const workers = makeWorkers(2)
  workers[0].crashOnRequest = true
  await assert.rejects(
    () =>
      solvePowParallel(BASE_INPUT, TEST_ITERS, TEST_DIFFICULTY, MAX_NONCE, workers),
    (error: unknown) => error instanceof Error && /mock crash/.test(error.message),
  )
}

{
  // abort → reject aborted 并 terminate 全部 worker
  // worker 置 hang（永不回复），保证只有 abort 路径能 settle
  const workers = makeWorkers(3)
  for (const w of workers) w.hang = true
  const controller = new AbortController()
  const promise = solvePowParallel(
    BASE_INPUT,
    TEST_ITERS,
    TEST_DIFFICULTY,
    MAX_NONCE,
    workers,
    controller.signal,
  )
  await new Promise((resolve) => setTimeout(resolve, 10))
  controller.abort()
  await assert.rejects(
    () => promise,
    (error: unknown) => error instanceof Error && error.message === 'aborted',
  )
  assert.ok(workers.every((w) => w.terminated), 'abort 后所有 worker 应被终止')
}

{
  // 空 worker 列表 → 直接报错
  await assert.rejects(
    () => solvePowParallel(BASE_INPUT, TEST_ITERS, TEST_DIFFICULTY, MAX_NONCE, []),
    (error: unknown) => error instanceof Error,
  )
}

console.log('pow-parallel 单测通过')
