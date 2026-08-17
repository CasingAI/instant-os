/**
 * PoW 并行求解客户端：把真实 `?worker` 构造器接到 pow-parallel.ts 的纯协调核心。
 *
 * 本模块含 Vite 专用 `?worker` 静态导入，只能被浏览器加载；
 * pow-client.ts 通过动态 import 引用本模块，node 单测不执行到该路径
 * （与 archive-worker-client.ts 的模式一致）。
 */
import PowWorkerCtor from './pow-worker.ts?worker'
import { solvePowParallel as solvePowParallelCore } from './pow-parallel.ts'

export type { ParallelPowResult, PowWorkerRequest, PowWorkerResponse } from './pow-parallel.ts'

/** 每请求最多 spawn 的 worker 数（hardwareConcurrency 上限） */
const MAX_WORKERS = 8

let workerDisabled = false

function createWorker(): Worker {
  return new PowWorkerCtor()
}

function resolveWorkerCount(): number {
  const available = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0
  if (available > 0) {
    return Math.max(1, Math.min(available, MAX_WORKERS))
  }
  return 1
}

/**
 * 并行求解：spawn count 个 worker 按 stride 切分 nonce，取最先命中者。
 * 创建 worker 抛错 → 置 workerDisabled 并抛错，由调用方降级串行。
 */
export async function solvePowParallel(
  baseInput: string,
  iters: number,
  difficulty: number,
  maxNonce: number,
  signal?: AbortSignal,
): Promise<import('./pow-parallel.ts').ParallelPowResult> {
  if (workerDisabled) {
    throw new Error('PoW worker 不可用')
  }

  const count = resolveWorkerCount()
  const workers: Worker[] = []
  for (let i = 0; i < count; i++) {
    try {
      workers.push(createWorker())
    } catch (error) {
      for (const worker of workers) {
        worker.terminate()
      }
      workerDisabled = true
      throw error
    }
  }

  try {
    return await solvePowParallelCore(
      baseInput,
      iters,
      difficulty,
      maxNonce,
      workers,
      signal,
    )
  } finally {
    // settle 时核心已 terminate；这里兜底确保 worker 一定被回收
    for (const worker of workers) {
      worker.terminate()
    }
  }
}
