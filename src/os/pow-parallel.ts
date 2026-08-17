/**
 * PoW 并行求解核心：在 N 个 worker 中按 stride 切分 nonce 空间并行搜索。
 *
 * 纯协调逻辑，不依赖 vite `?worker`（worker 由调用方创建并传入），
 * 因此可被 node --experimental-strip-types 单测（用模拟 worker 注入）。
 */

export type ParallelPowResult = {
  nonce: number
  hash: string
}

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
  | { type: 'progress'; tried: number }

/**
 * 并行求解：把 workers（已创建）按 stride 切分 nonce 空间，取最先命中者。
 *
 * - 任一 worker 命中 → resolve；其余 worker 全部 terminate。
 * - 全部 worker 报 done（区间搜完仍无解）→ reject not-found。
 * - 任一 worker error → reject（运行时错误按次降级，不永久禁用）。
 * - signal 触发 → 全部 terminate 并 reject aborted。
 * - 调用方负责在 finally 中 terminate 全部 worker（这里 settle 时也会 terminate，
 *   重复 terminate 是 no-op，无害）。
 */
export async function solvePowParallel(
  baseInput: string,
  iters: number,
  difficulty: number,
  maxNonce: number,
  workers: Worker[],
  signal?: AbortSignal,
  onProgress?: (tried: number) => void,
): Promise<ParallelPowResult> {
  const count = workers.length
  if (count === 0) {
    throw new Error('PoW worker 数量为 0')
  }

  const terminateAll = () => {
    for (const worker of workers) {
      worker.terminate()
    }
  }

  if (signal?.aborted) {
    terminateAll()
    throw new Error('aborted')
  }

  const request: PowWorkerRequest = {
    type: 'solve',
    baseInput,
    iters,
    difficulty,
    stride: count,
    offset: 0,
    maxNonce,
  }

  return await new Promise<ParallelPowResult>((resolve, reject) => {
    let settled = false
    let doneCount = 0
    // 各 worker 已完成的迭代次数；stride 切分互不重叠，求和即精确的已尝试 nonce 数
    const workerIters = new Array<number>(count).fill(0)

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      terminateAll()
      if (signal) signal.removeEventListener('abort', onAbort)
      fn()
    }

    const onAbort = () => {
      settle(() => reject(new Error('aborted')))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    workers.forEach((worker, index) => {
      const onMessage = (event: MessageEvent<PowWorkerResponse>) => {
        const response = event.data
        if (response.type === 'found') {
          settle(() => resolve({ nonce: response.nonce, hash: response.hash }))
        } else if (response.type === 'done') {
          doneCount += 1
          if (doneCount === count) {
            settle(() => reject(new Error('not-found')))
          }
        } else if (response.type === 'progress') {
          if (onProgress) {
            // tried = 尚未开始搜索的下一个 nonce；已完成迭代 = (tried - 1 - offset) / stride + 1
            const iters = Math.floor((response.tried - 1 - index) / count) + 1
            workerIters[index] = Math.max(workerIters[index], iters)
            const totalTried = workerIters.reduce((acc, n) => acc + n, 0)
            onProgress(Math.min(totalTried, request.maxNonce))
          }
        }
      }
      const onError = (event: ErrorEvent) => {
        settle(() => reject(new Error(event.message || 'PoW worker 错误')))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.postMessage({ ...request, offset: index })
    })
  })
}
