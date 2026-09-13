/**
 * 窗口关闭处理流程的纯逻辑：等待回答的状态机 + 「handler 回答 vs 超时」竞速。
 * os-context 负责接线（调 handler、关窗、弹「未响应」窗），这里只放可单测的推导。
 */

/** 关闭处理在约 5 秒内必须给出的回答：「结束」或「不能结束」。 */
export const WINDOW_CLOSE_HANDLER_TIMEOUT_MS = 5000

export type WindowCloseHandlerAnswer = 'finish' | 'cannot-finish'

export type WindowCloseHandler = () => Promise<WindowCloseHandlerAnswer>

/**
 * 关闭流程状态：
 * - idle：无等待
 * - waiting：已向 handler 派发关闭事件，等待回答（startedAt 供续等时重置超时）
 * - unresponsive：超时未回答，等用户在系统「未响应」弹窗里选择
 */
export type WindowCloseFlowState =
  | { phase: 'idle' }
  | { phase: 'waiting'; windowId: string; startedAt: number }
  | { phase: 'unresponsive'; windowId: string }

export type WindowCloseFlowEvent =
  | { type: 'close-requested'; windowId: string; now: number }
  | { type: 'handler-answered'; answer: WindowCloseHandlerAnswer }
  | { type: 'handler-timeout' }
  | { type: 'wait-again'; now: number }
  | { type: 'resolved' }

/**
 * 关闭流程状态机。副作用（真正关窗）由调用方按回答自行执行；
 * 这里只推导状态：
 * - close-requested：非 idle 时忽略（防重入，同一时刻只等一扇窗）
 * - handler-answered：任何回答都结束等待（关不关窗由调用方看 answer 决定）
 * - handler-timeout：waiting → unresponsive（系统弹「未响应」窗）
 * - wait-again：unresponsive → waiting，startedAt 重置（续 5 秒，可再超时再问）
 * - resolved：强制结束 / 窗口已不在等一切收口，回到 idle
 */
export function evaluateWindowCloseFlow(
  state: WindowCloseFlowState,
  event: WindowCloseFlowEvent,
): WindowCloseFlowState {
  switch (event.type) {
    case 'close-requested': {
      if (state.phase !== 'idle') {
        return state
      }
      return { phase: 'waiting', windowId: event.windowId, startedAt: event.now }
    }
    case 'handler-answered': {
      if (state.phase === 'idle') {
        return state
      }
      return { phase: 'idle' }
    }
    case 'handler-timeout': {
      if (state.phase !== 'waiting') {
        return state
      }
      return { phase: 'unresponsive', windowId: state.windowId }
    }
    case 'wait-again': {
      if (state.phase !== 'unresponsive') {
        return state
      }
      return { phase: 'waiting', windowId: state.windowId, startedAt: event.now }
    }
    case 'resolved': {
      return { phase: 'idle' }
    }
  }
}

export type WindowCloseRaceOutcome =
  | { outcome: 'answered'; answer: WindowCloseHandlerAnswer }
  | { outcome: 'timeout' }
  | { outcome: 'cancelled' }

/**
 * 单 flow 期间到达的关窗请求排队（FIFO 去重）：os-context 在流程非 idle 时把新
 * 请求先记下，流程回 idle 后按序重新走一遍 closeWindow 的现逻辑。
 */
export function enqueuePendingCloseWindow(
  queue: readonly string[],
  windowId: string,
): readonly string[] {
  return queue.includes(windowId) ? queue : [...queue, windowId]
}

/**
 * 出队下一个可发起的关窗请求：按 FIFO 跳过 isEligible 不通过的窗口（排队期间
 * 已被其它方式关闭），返回队首可用窗口与剩余队列（跳过的死窗口丢弃，返回窗口
 * 之后的条目留给后续出队）；没有可用窗口时返回 undefined（跳过的都是死窗口，
 * 调用方可直接清空队列）。
 */
export function nextPendingCloseWindow(
  queue: readonly string[],
  isEligible: (windowId: string) => boolean,
): { windowId: string; rest: readonly string[] } | undefined {
  for (let index = 0; index < queue.length; index += 1) {
    const windowId = queue[index]!
    if (!isEligible(windowId)) {
      continue
    }
    return { windowId, rest: queue.slice(index + 1) }
  }
  return undefined
}

/** 可注入的定时器（测试用假时钟；生产为 setTimeout/clearTimeout）。 */
export type WindowCloseRaceScheduler = (callback: () => void, ms: number) => () => void

const defaultSchedule: WindowCloseRaceScheduler = (callback, ms) => {
  const timer = setTimeout(callback, ms)
  return () => clearTimeout(timer)
}

/**
 * 「handler 的回答」对「超时」的竞速。answer 是已在途的 handler Promise
 * （续等时复用同一个 Promise，只是重开 5 秒计时，不重调 handler）。
 * - 回答先到 → { outcome: 'answered', answer }；handler 抛异常视作「不能结束」
 *   （异常不是「结束」的许可，窗口留着由人处置）
 * - 超时先到 → { outcome: 'timeout' }
 * - cancel()：撤掉计时并把结果定为 'cancelled'（窗口已被其它途径关掉时收口用）
 */
export function raceWindowCloseHandlerAnswer(
  answer: Promise<WindowCloseHandlerAnswer>,
  options?: {
    timeoutMs?: number
    schedule?: WindowCloseRaceScheduler
  },
): {
  result: Promise<WindowCloseRaceOutcome>
  cancel: () => void
} {
  const timeoutMs = options?.timeoutMs ?? WINDOW_CLOSE_HANDLER_TIMEOUT_MS
  const schedule = options?.schedule ?? defaultSchedule
  let settled = false
  let cancelTimer: () => void = () => {}
  let resolveResult: ((outcome: WindowCloseRaceOutcome) => void) | undefined
  const result = new Promise<WindowCloseRaceOutcome>((resolve) => {
    resolveResult = resolve
    const finish = (outcome: WindowCloseRaceOutcome) => {
      if (settled) {
        return
      }
      settled = true
      cancelTimer()
      resolve(outcome)
    }
    cancelTimer = schedule(() => finish({ outcome: 'timeout' }), timeoutMs)
    answer.then(
      (value) => finish({ outcome: 'answered', answer: value }),
      () => finish({ outcome: 'answered', answer: 'cannot-finish' }),
    )
  })
  return {
    result,
    cancel: () => {
      cancelTimer()
      if (!settled) {
        settled = true
        resolveResult?.({ outcome: 'cancelled' })
      }
    },
  }
}
