/**
 * 窗口关闭处理流程纯逻辑单测：等待 handler + 5 秒超时 + 续等 + 强制收口。
 * 运行：node --experimental-strip-types src/os/os-close-handler.test.ts
 */
import assert from 'node:assert/strict'
import {
  enqueuePendingCloseWindow,
  evaluateWindowCloseFlow,
  nextPendingCloseWindow,
  raceWindowCloseHandlerAnswer,
  WINDOW_CLOSE_HANDLER_TIMEOUT_MS,
  type WindowCloseFlowState,
  type WindowCloseHandlerAnswer,
  type WindowCloseRaceOutcome,
  type WindowCloseRaceScheduler,
} from './window-close-flow.ts'

/** 可手动推进的假时钟：schedule 返回撤销函数，advance 触发到期回调。 */
function createFakeScheduler() {
  let now = 0
  let seq = 0
  const timers = new Map<number, { id: number; at: number; callback: () => void }>()
  const schedule: WindowCloseRaceScheduler = (callback, ms) => {
    seq += 1
    const timer = { id: seq, at: now + ms, callback }
    timers.set(timer.id, timer)
    return () => {
      timers.delete(timer.id)
    }
  }
  const advance = (ms: number) => {
    now += ms
    const due = [...timers.values()].filter((timer) => timer.at <= now).sort((a, b) => a.at - b.at)
    for (const timer of due) {
      timers.delete(timer.id)
      timer.callback()
    }
  }
  return { schedule, advance }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
  }
}

function pendingOutcome(): { outcome: () => WindowCloseRaceOutcome | undefined; record: (outcome: WindowCloseRaceOutcome) => void } {
  let captured: WindowCloseRaceOutcome | undefined
  return {
    outcome: () => captured,
    record: (value) => {
      captured = value
    },
  }
}

async function testHandlerAnswersFinish(): Promise<void> {
  const fake = createFakeScheduler()
  const race = raceWindowCloseHandlerAnswer(Promise.resolve('finish'), { schedule: fake.schedule })
  await flushMicrotasks()
  assert.deepEqual(await race.result, { outcome: 'answered', answer: 'finish' })

  let state: WindowCloseFlowState = { phase: 'waiting', windowId: 'vm-1', startedAt: 0 }
  state = evaluateWindowCloseFlow(state, { type: 'handler-answered', answer: 'finish' })
  assert.equal(state.phase, 'idle', '回答「结束」→ 等待结束（调用方随即真正关窗）')
}

async function testHandlerAnswersCannotFinish(): Promise<void> {
  const fake = createFakeScheduler()
  const race = raceWindowCloseHandlerAnswer(Promise.resolve('cannot-finish'), {
    schedule: fake.schedule,
  })
  await flushMicrotasks()
  assert.deepEqual(await race.result, { outcome: 'answered', answer: 'cannot-finish' })

  let state: WindowCloseFlowState = { phase: 'waiting', windowId: 'vm-1', startedAt: 0 }
  state = evaluateWindowCloseFlow(state, { type: 'handler-answered', answer: 'cannot-finish' })
  assert.equal(state.phase, 'idle', '回答「不能结束」→ 窗口留着，流程回 idle')
}

async function testHandlerRejectionCountsAsCannotFinish(): Promise<void> {
  const fake = createFakeScheduler()
  const answer = Promise.reject(new Error('handler 崩了'))
  const race = raceWindowCloseHandlerAnswer(answer, { schedule: fake.schedule })
  await flushMicrotasks()
  assert.deepEqual(await race.result, { outcome: 'answered', answer: 'cannot-finish' })
}

async function testTimeoutTransitionsToUnresponsive(): Promise<void> {
  const fake = createFakeScheduler()
  const answer = new Promise<WindowCloseHandlerAnswer>(() => {}) // 永不回答
  const race = raceWindowCloseHandlerAnswer(answer, { schedule: fake.schedule })
  const captured = pendingOutcome()
  void race.result.then(captured.record)

  let state: WindowCloseFlowState = { phase: 'waiting', windowId: 'vm-1', startedAt: 0 }
  fake.advance(WINDOW_CLOSE_HANDLER_TIMEOUT_MS - 1)
  await flushMicrotasks()
  assert.equal(captured.outcome(), undefined, '4999ms 不应超时')

  fake.advance(1)
  await flushMicrotasks()
  assert.deepEqual(captured.outcome(), { outcome: 'timeout' })

  state = evaluateWindowCloseFlow(state, { type: 'handler-timeout' })
  assert.equal(state.phase, 'unresponsive', '超时 → 未响应，等用户在系统弹窗里选择')
  assert.equal(state.phase === 'unresponsive' && state.windowId, 'vm-1')
}

async function testWaitAgainResetsTimeoutAndCanLoop(): Promise<void> {
  const fake = createFakeScheduler()
  const answer = new Promise<WindowCloseHandlerAnswer>(() => {}) // 一直不回答

  let state: WindowCloseFlowState = evaluateWindowCloseFlow(
    { phase: 'idle' },
    { type: 'close-requested', windowId: 'vm-1', now: 0 },
  )

  // 第一轮：5 秒超时
  const round1 = raceWindowCloseHandlerAnswer(answer, { schedule: fake.schedule })
  fake.advance(WINDOW_CLOSE_HANDLER_TIMEOUT_MS)
  assert.deepEqual(await round1.result, { outcome: 'timeout' })
  state = evaluateWindowCloseFlow(state, { type: 'handler-timeout' })
  assert.equal(state.phase, 'unresponsive')

  // 用户选「继续等待」：回到等待态，计时重置（续 5 秒）
  state = evaluateWindowCloseFlow(state, { type: 'wait-again', now: WINDOW_CLOSE_HANDLER_TIMEOUT_MS })
  assert.equal(state.phase, 'waiting')
  assert.equal(
    state.phase === 'waiting' && state.startedAt,
    WINDOW_CLOSE_HANDLER_TIMEOUT_MS,
    '续等要重置 startedAt（重新计 5 秒）',
  )

  const round2 = raceWindowCloseHandlerAnswer(answer, { schedule: fake.schedule })
  const captured = pendingOutcome()
  void round2.result.then(captured.record)
  fake.advance(WINDOW_CLOSE_HANDLER_TIMEOUT_MS - 1)
  await flushMicrotasks()
  assert.equal(captured.outcome(), undefined, '续等后旧时限不起作用，新 5 秒未到不超时')
  fake.advance(1)
  await flushMicrotasks()
  assert.deepEqual(captured.outcome(), { outcome: 'timeout' }, '续等再超时')

  state = evaluateWindowCloseFlow(state, { type: 'handler-timeout' })
  assert.equal(state.phase, 'unresponsive', '再次超时再次进入未响应（可循环再问）')
}

async function testWaitAgainThenAnswerArrives(): Promise<void> {
  const fake = createFakeScheduler()
  let resolveAnswer: (answer: WindowCloseHandlerAnswer) => void = () => {}
  const answer = new Promise<WindowCloseHandlerAnswer>((resolve) => {
    resolveAnswer = resolve
  })

  const round1 = raceWindowCloseHandlerAnswer(answer, { schedule: fake.schedule })
  fake.advance(WINDOW_CLOSE_HANDLER_TIMEOUT_MS)
  assert.deepEqual(await round1.result, { outcome: 'timeout' })

  // 续等复用同一个在途回答：不重调 handler，回答一到立即送达
  const round2 = raceWindowCloseHandlerAnswer(answer, { schedule: fake.schedule })
  resolveAnswer('finish')
  await flushMicrotasks()
  assert.deepEqual(await round2.result, { outcome: 'answered', answer: 'finish' })

  let state: WindowCloseFlowState = { phase: 'waiting', windowId: 'vm-1', startedAt: 5000 }
  state = evaluateWindowCloseFlow(state, { type: 'handler-answered', answer: 'finish' })
  assert.equal(state.phase, 'idle')
}

function testCloseRequestedIsIgnoredWhileFlowActive(): void {
  let state: WindowCloseFlowState = { phase: 'waiting', windowId: 'vm-1', startedAt: 0 }
  assert.equal(
    evaluateWindowCloseFlow(state, { type: 'close-requested', windowId: 'vm-1', now: 100 }),
    state,
    '等待期间再点关闭：状态机保持单流程防重入',
  )
  assert.equal(
    evaluateWindowCloseFlow(state, { type: 'close-requested', windowId: 'other-1', now: 100 }),
    state,
    '等待期间关别的窗口：状态机同样忽略（该请求由 os-context 排队，见下方排队测试）',
  )

  const unresponsive: WindowCloseFlowState = { phase: 'unresponsive', windowId: 'vm-1' }
  assert.equal(
    evaluateWindowCloseFlow(unresponsive, { type: 'close-requested', windowId: 'vm-1', now: 100 }),
    unresponsive,
    '未响应弹窗期间再点关闭：忽略',
  )
}

/** 等待一扇窗的关闭回应时又点了另一扇窗的 X：请求排队，第一窗收口后按序发起。 */
function testQueuedCloseRunsAfterFlowSettles(): void {
  // 排队 FIFO 去重：同一窗口重复请求只排一次
  const queue = enqueuePendingCloseWindow(
    enqueuePendingCloseWindow(enqueuePendingCloseWindow([], 'other-1'), 'other-2'),
    'other-1',
  )
  assert.deepEqual(queue, ['other-1', 'other-2'])

  // 出队跳过排队期间已被其它方式关闭的窗口（死窗口从队列里丢弃）
  const alive = new Set(['other-1', 'other-2'])
  const first = nextPendingCloseWindow(['gone-1', 'other-1', 'gone-2', 'other-2'], (id) =>
    alive.has(id),
  )
  assert.deepEqual(first, { windowId: 'other-1', rest: ['gone-2', 'other-2'] })
  const second = nextPendingCloseWindow(first!.rest, (id) => alive.has(id))
  assert.deepEqual(second, { windowId: 'other-2', rest: [] })
  assert.equal(nextPendingCloseWindow(['gone-1'], (id) => alive.has(id)), undefined)

  // 全流程模拟：第一窗等待中来了第二窗的关闭请求 → 状态机保持单流程忽略，
  // 第一窗回答收口回 idle → 第二窗的流程被发起（而不是被默默丢掉）
  let state: WindowCloseFlowState = evaluateWindowCloseFlow(
    { phase: 'idle' },
    { type: 'close-requested', windowId: 'vm-1', now: 0 },
  )
  state = evaluateWindowCloseFlow(state, { type: 'handler-timeout' })
  assert.equal(state.phase, 'unresponsive')
  assert.equal(
    evaluateWindowCloseFlow(state, { type: 'close-requested', windowId: 'other-1', now: 100 }),
    state,
  )
  state = evaluateWindowCloseFlow(state, { type: 'resolved' })
  assert.equal(state.phase, 'idle')
  const queued = nextPendingCloseWindow(['other-1'], () => true)
  assert.ok(queued)
  state = evaluateWindowCloseFlow(state, {
    type: 'close-requested',
    windowId: queued.windowId,
    now: 200,
  })
  assert.equal(state.phase, 'waiting', '第一窗收口后，排队中的第二窗关窗被发起')
  assert.equal(state.phase === 'waiting' && state.windowId, 'other-1')
}

function testResolvedClearsAnyState(): void {
  assert.deepEqual(
    evaluateWindowCloseFlow({ phase: 'waiting', windowId: 'vm-1', startedAt: 0 }, { type: 'resolved' }),
    { phase: 'idle' },
    '强制结束收口等待态',
  )
  assert.deepEqual(
    evaluateWindowCloseFlow({ phase: 'unresponsive', windowId: 'vm-1' }, { type: 'resolved' }),
    { phase: 'idle' },
    '强制结束收口未响应态',
  )
  assert.deepEqual(evaluateWindowCloseFlow({ phase: 'idle' }, { type: 'resolved' }), {
    phase: 'idle',
  })
}

function testStaleEventsDoNotReviveFlow(): void {
  // 流程已收口（如强制结束）后迟到的超时/回答，不得把状态拉回 waiting/unresponsive
  const idle: WindowCloseFlowState = { phase: 'idle' }
  assert.equal(evaluateWindowCloseFlow(idle, { type: 'handler-timeout' }), idle)
  assert.equal(evaluateWindowCloseFlow(idle, { type: 'handler-answered', answer: 'finish' }), idle)
  assert.equal(evaluateWindowCloseFlow(idle, { type: 'wait-again', now: 0 }), idle)
}

async function testCancelSettlesAsCancelled(): Promise<void> {
  const fake = createFakeScheduler()
  const answer = new Promise<WindowCloseHandlerAnswer>(() => {})
  const race = raceWindowCloseHandlerAnswer(answer, { schedule: fake.schedule })
  race.cancel()
  fake.advance(WINDOW_CLOSE_HANDLER_TIMEOUT_MS)
  await flushMicrotasks()
  assert.deepEqual(await race.result, { outcome: 'cancelled' }, '窗口被其它途径关掉时收口竞速')
}

async function main(): Promise<void> {
  const cases: ((() => void) | (() => Promise<void>))[] = [
    testHandlerAnswersFinish,
    testHandlerAnswersCannotFinish,
    testHandlerRejectionCountsAsCannotFinish,
    testTimeoutTransitionsToUnresponsive,
    testWaitAgainResetsTimeoutAndCanLoop,
    testWaitAgainThenAnswerArrives,
    testCloseRequestedIsIgnoredWhileFlowActive,
    testQueuedCloseRunsAfterFlowSettles,
    testResolvedClearsAnyState,
    testStaleEventsDoNotReviveFlow,
    testCancelSettlesAsCancelled,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('os-close-handler: all passed')
}

await main()
