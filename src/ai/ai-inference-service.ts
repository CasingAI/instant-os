/**
 * AI 推理调度服务（主线程单例）。
 *
 * 统一管理本地 onnxruntime 模型 worker（htdemucs / MDX / wav2vec2）的推理队列与生命周期：
 * - 全局 FIFO 队列：一次只执行一个推理任务，其余排队，任务间严格串行。
 * - 内存有界：任意时刻至多一个 worker 存活并持有模型；换模型时先 terminate 旧 worker
 *   （整个隔离堆 + WASM 内存随 worker 一起回收），再创建目标模型的 worker。
 * - 空闲卸载：任务完成且队列为空后 AI_IDLE_UNLOAD_MS 到期自动 terminate worker 释放模型；
 *   期间新任务到达则取消计时器复用。
 * - 取消：AbortSignal 触发时，在途任务直接 terminate worker（onnx 推理难以中途打断），
 *   排队任务从队列移除；无 abortedValue 时以 undefined 结案（取消不是错误）。
 * - 状态经 worker-heap-reports 上报，在「服务」面板可见。
 *
 * 各模型 worker 文件本身不变（只处理单一请求），生命周期完全由本服务接管。
 */
import { isWorkerHeapSampleMessage } from '../os/worker-heap-sampler.ts'
import { upsertWorkerHeapReport } from '../os/worker-heap-reports.ts'
import type { ServiceRoute } from '../os/service-supervisor.ts'
import StemsWorker from '../apps/stems/stems-worker.ts?worker'
import MdxVocalWorker from '../apps/stems/mdx-vocal-worker.ts?worker'
import PhonemeWorker from '../apps/stems/phoneme-worker.ts?worker'

/** 「服务」面板中本服务的固定 ID。 */
export const AI_INFERENCE_SERVICE_ID = 'ai-inference'

/** 任务完成且队列为空后，空闲多少毫秒自动卸载模型（terminate worker）。 */
export const AI_IDLE_UNLOAD_MS = 60_000

export type AiModelId = 'stems-htdemucs' | 'stems-mdx' | 'phoneme-wav2vec2'

const AI_MODELS: Record<AiModelId, { label: string; createWorker: () => Worker }> = {
  'stems-htdemucs': {
    label: 'HTDemucs 6-stem（分轨模型）',
    createWorker: () => new StemsWorker(),
  },
  'stems-mdx': {
    label: 'MDX-NET 人声分离（伴奏模型）',
    createWorker: () => new MdxVocalWorker(),
  },
  'phoneme-wav2vec2': {
    label: 'wav2vec2 音素识别（歌词对齐）',
    createWorker: () => new PhonemeWorker(),
  },
}

export type AiTaskOptions<Res, T> = {
  /**
   * 路由模型 worker 的每条响应（协议中可能含 model-loading / chunk 等中间消息）。
   * 返回 resolve / reject 时任务结束，返回 continue 则继续等待下一条。
   * 缺省：第一条消息直接 resolve。
   */
  route?: (message: Res) => ServiceRoute<T>
  /** 取消信号：触发时在途任务终止 worker、排队任务出队，用 abortedValue 结案。 */
  signal?: AbortSignal
  abortedValue?: () => T
}

type TaskEntry<Res, T> = {
  modelId: AiModelId
  payload: unknown
  route: (message: Res) => ServiceRoute<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
  abortedValue?: () => T
  signal?: AbortSignal
  abortListener?: () => void
}

let worker: Worker | undefined
let currentModelId: AiModelId | null = null
let activeTask: TaskEntry<unknown, unknown> | null = null
/** FIFO 队列：任务入队即排队，一次只执行队头一个。 */
const queue: TaskEntry<unknown, unknown>[] = []
let idleTimer: ReturnType<typeof setTimeout> | undefined

function syncReport(): void {
  const label = currentModelId ? AI_MODELS[currentModelId].label : '无'
  upsertWorkerHeapReport({
    id: AI_INFERENCE_SERVICE_ID,
    label: 'AI 推理服务',
    description: `统一调度本地模型推理：一次只驻留一个模型（当前：${label}），空闲自动卸载释放内存。`,
    status: worker ? 'running' : 'stopped',
    at: Date.now(),
  })
}

function clearIdleTimer(): void {
  if (idleTimer === undefined) return
  clearTimeout(idleTimer)
  idleTimer = undefined
}

function scheduleIdleUnload(): void {
  if (!worker) return
  if (idleTimer !== undefined) return
  idleTimer = setTimeout(() => {
    idleTimer = undefined
    if (activeTask || queue.length > 0) return
    teardownWorker()
  }, AI_IDLE_UNLOAD_MS)
}

function teardownWorker(): void {
  clearIdleTimer()
  if (worker) {
    try {
      worker.terminate()
    } catch {
      // 忽略 terminate 异常
    }
    worker = undefined
  }
  currentModelId = null
  syncReport()
}

function spawnWorkerFor(modelId: AiModelId): Worker {
  const instance = AI_MODELS[modelId].createWorker()
  instance.onmessage = (event: MessageEvent) => {
    handleWorkerMessage(instance, event)
  }
  instance.onerror = (event: ErrorEvent) => {
    handleWorkerError(instance, event)
  }
  return instance
}

function handleWorkerMessage(instance: Worker, event: MessageEvent): void {
  if (worker !== instance) return // 旧 worker 的滞留消息
  const message = event.data as unknown
  if (isWorkerHeapSampleMessage(message)) {
    syncReport()
    return
  }
  const task = activeTask
  if (!task) return

  let result: ServiceRoute<unknown>
  try {
    result = task.route(message as never) as ServiceRoute<unknown>
  } catch (error) {
    result = {
      action: 'reject',
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
  if (result.action === 'continue') return
  settleTask(task, result)
}

function handleWorkerError(instance: Worker, event: ErrorEvent): void {
  if (worker !== instance) return
  const reason = event.message ? `：${event.message}` : ''
  const task = activeTask
  teardownWorker()
  if (task) {
    activeTask = null
    detachAbort(task)
    task.reject(new Error(`AI 推理 Worker 崩溃${reason}`))
  }
  syncReport()
  pump()
}

function detachAbort(entry: TaskEntry<unknown, unknown>): void {
  if (entry.abortListener && entry.signal) {
    entry.signal.removeEventListener('abort', entry.abortListener)
    entry.abortListener = undefined
  }
}

function settleTask(entry: TaskEntry<unknown, unknown>, result: ServiceRoute<unknown>): void {
  if (activeTask !== entry) return
  activeTask = null
  detachAbort(entry)
  if (result.action === 'continue') return
  if (result.action === 'resolve') {
    entry.resolve(result.value as never)
  } else {
    entry.reject(result.error)
  }
  syncReport()
  pump()
}

function ensureWorkerFor(modelId: AiModelId): Worker | undefined {
  if (worker && currentModelId === modelId) return worker
  // 换模型：先释放旧 worker（其持有的模型内存随隔离堆一起回收），再创建目标模型
  teardownWorker()
  try {
    worker = spawnWorkerFor(modelId)
    currentModelId = modelId
    syncReport()
    return worker
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const task = activeTask
    activeTask = null
    if (task) {
      detachAbort(task)
      task.reject(new Error(`AI 推理 Worker 创建失败：${message}`))
    }
    syncReport()
    return undefined
  }
}

function pump(): void {
  if (activeTask) return
  clearIdleTimer()
  if (queue.length === 0) {
    scheduleIdleUnload()
    return
  }
  const entry = queue.shift() as TaskEntry<unknown, unknown>
  activeTask = entry
  const instance = ensureWorkerFor(entry.modelId)
  if (!instance) {
    // 创建失败：activeTask 已在 ensureWorkerFor 内清空并 reject，继续处理剩余队列
    pump()
    return
  }
  instance.postMessage(entry.payload)
  syncReport()
}

function onTaskAbort(entry: TaskEntry<unknown, unknown>): void {
  if (activeTask === entry) {
    // 在途任务：terminate worker 中断推理并卸载模型
    activeTask = null
    detachAbort(entry)
    teardownWorker()
    entry.resolve(entry.abortedValue?.() as never)
    pump()
    return
  }
  const index = queue.indexOf(entry)
  if (index >= 0) {
    queue.splice(index, 1)
    detachAbort(entry)
    entry.resolve(entry.abortedValue?.() as never)
  }
}

/**
 * 提交一个 AI 推理任务到全局队列。同模型任务复用已加载的 worker；
 * 不同模型任务先释放旧模型再加载目标模型（内存有界）。
 * 返回一个在任务完成时 resolve、失败时 reject 的 Promise。
 */
export function enqueueAiTask<Res, T>(
  modelId: AiModelId,
  payload: unknown,
  options?: AiTaskOptions<Res, T>,
): Promise<T> {
  const signal = options?.signal
  if (signal?.aborted) {
    return Promise.resolve(options?.abortedValue?.() as T)
  }
  return new Promise<T>((resolve, reject) => {
    const entry: TaskEntry<Res, T> = {
      modelId,
      payload,
      route: (options?.route ??
        ((message: unknown): ServiceRoute<unknown> => ({
          action: 'resolve',
          value: message,
        }))) as (message: Res) => ServiceRoute<T>,
      resolve,
      reject,
      abortedValue: options?.abortedValue,
      signal,
    }
    // 入队即挂取消监听：排队期间 signal 触发也能立即出队（不必等轮到它）
    if (signal) {
      const onAbort = (): void => onTaskAbort(entry as unknown as TaskEntry<unknown, unknown>)
      entry.abortListener = onAbort
      signal.addEventListener('abort', onAbort, { once: true })
    }
    queue.push(entry as unknown as TaskEntry<unknown, unknown>)
    pump()
  })
}

/** 当前是否已有模型 worker 存活（有模型驻留内存）。 */
export function aiInferenceHasModelLoaded(): boolean {
  return worker !== undefined
}

/**
 * 停止服务：terminate 当前 worker（卸载模型），拒绝全部排队与在途任务。
 * 供「服务」面板停止/重启按钮使用。
 */
export function stopAiInference(): void {
  const pending = [...queue]
  queue.length = 0
  for (const entry of pending) {
    detachAbort(entry)
    entry.reject(new Error('AI 推理服务已停止'))
  }
  if (activeTask) {
    detachAbort(activeTask)
    activeTask.reject(new Error('AI 推理服务已停止'))
    activeTask = null
  }
  teardownWorker()
  pump()
}

/**
 * 重启服务：同 stop（调度器按需拉起，重启即清理当前驻留模型与队列）。
 * 供「服务」面板重启按钮使用。
 */
export function restartAiInference(): void {
  stopAiInference()
}

// 模块加载即登记服务条目，保证「服务」面板始终可见（与 tokenizer 的 defineService 一致）
syncReport()
