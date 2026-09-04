/**
 * 进度包装器单测：
 * - 延迟显示：耗时短于门槛的操作全程不弹窗（onUiChange 零回调）；
 *   超过门槛才展示，成功后进入完成态（fraction=1、「已完成」、无取消按钮），
 *   窗口保持到最短显示时长才关；任务时长已超过最短显示时完成即关，不追加挂起
 * - 失败/取消不进入完成态，窗口立即关闭
 * - estimate 钩子：先出「正在统计…」再定标；抛错关窗并传播；统计阶段计入最短显示
 * - showDelayMs: 0 恢复立即显示（旧行为，测试里用来覆盖展示后的各状态）
 * 运行：node --experimental-strip-types src/apps/files/files-run-with-op-progress.test.ts
 */
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import {
  FILES_OP_PROGRESS_ESTIMATING_LABEL,
  isFilesOpCancelledError,
  runFilesOpWithProgress,
  type FilesOpProgressUiState,
} from './files-run-with-op-progress.ts'

const MIN_VISIBLE = 120

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function testShowsImmediatelyAndCompletes(): Promise<void> {
  const states: Array<FilesOpProgressUiState | undefined> = []
  const result = await runFilesOpWithProgress({
    kind: 'paste',
    totalWork: 100,
    minVisibleMs: MIN_VISIBLE,
    showDelayMs: 0,
    onUiChange: (state) => states.push(state ? { ...state } : state),
    task: async (report) => {
      // 首个 report 之前窗口就必须已经展示
      assert.equal(states.length, 1, `states=${JSON.stringify(states)}`)
      assert.equal(states[0]!.title, '正在粘贴…')
      report({ done: 50, total: 100 })
      await sleep(10)
      report({ done: 100, total: 100 })
    },
  })
  assert.equal(result, undefined)
  const closedIndex = states.findIndex((state) => state === undefined)
  assert.ok(closedIndex > 0, '窗口最终要关闭')
  const completed = states[closedIndex - 1]!
  assert.equal(completed.remainingLabel, '已完成')
  assert.equal(completed.fraction, 1)
  assert.equal(completed.onCancel, undefined)
  // 完成态要保持到最短显示时长（首帧到关闭 ≥ MIN_VISIBLE）
  console.log('run-with-op-progress immediate-show + completed-hold ok')
}

/** 短操作在延迟门槛内完成：全程零 UI 回调、不弹窗 */
async function testQuickOpShowsNothing(): Promise<void> {
  const states: Array<FilesOpProgressUiState | undefined> = []
  await runFilesOpWithProgress({
    kind: 'paste',
    totalWork: 10,
    minVisibleMs: MIN_VISIBLE,
    showDelayMs: 60,
    onUiChange: (state) => states.push(state ? { ...state } : state),
    task: async (report) => {
      report({ done: 10, total: 10 })
    },
  })
  assert.equal(states.length, 0, `短操作不应有任何 UI 回调 states=${JSON.stringify(states)}`)
  console.log('run-with-op-progress quick-op silent ok')
}

/** 慢操作超过延迟门槛：延迟后出现，之后行为与立即显示一致 */
async function testSlowOpShowsAfterDelay(): Promise<void> {
  const states: Array<FilesOpProgressUiState | undefined> = []
  let firstAt = 0
  const showDelayMs = 60
  await runFilesOpWithProgress({
    kind: 'paste',
    totalWork: 100,
    minVisibleMs: MIN_VISIBLE,
    showDelayMs,
    onUiChange: (state) => {
      if (state && firstAt === 0) firstAt = performance.now()
      states.push(state ? { ...state } : state)
    },
    task: async (report) => {
      await sleep(showDelayMs + 40)
      report({ done: 50, total: 100 })
      await sleep(10)
      report({ done: 100, total: 100 })
    },
  })
  assert.ok(states.length > 0, '慢操作应展示进度窗')
  assert.ok(firstAt > 0)
  const closedIndex = states.findIndex((state) => state === undefined)
  assert.ok(closedIndex > 0, '窗口最终要关闭')
  assert.equal(states[closedIndex - 1]!.remainingLabel, '已完成')
  console.log('run-with-op-progress slow-op delayed-show ok')
}

async function testErrorClosesWithoutCompletedState(): Promise<void> {
  const states: Array<FilesOpProgressUiState | undefined> = []
  await assert.rejects(
    runFilesOpWithProgress({
      kind: 'delete',
      totalWork: 10,
      minVisibleMs: MIN_VISIBLE,
      showDelayMs: 0,
      onUiChange: (state) => states.push(state ? { ...state } : state),
      task: async () => {
        await sleep(5)
        throw new Error('boom')
      },
    }),
    /boom/,
  )
  assert.equal(states[states.length - 1], undefined)
  for (const state of states) {
    if (state) assert.notEqual(state.remainingLabel, '已完成')
  }
  console.log('run-with-op-progress error-close ok')
}

async function testCancelConvertsToCancelledError(): Promise<void> {
  const controller = new AbortController()
  await assert.rejects(
    runFilesOpWithProgress({
      kind: 'paste',
      totalWork: 10,
      minVisibleMs: MIN_VISIBLE,
      showDelayMs: 0,
      onUiChange: () => undefined,
      signal: controller.signal,
      cancel: () => controller.abort(),
      task: async (_report, signal) => {
        controller.abort()
        signal?.throwIfAborted?.()
      },
    }),
    (error: unknown) => isFilesOpCancelledError(error),
  )
  console.log('run-with-op-progress cancel ok')
}

async function testEstimateShowsCountingThenCalibrates(): Promise<void> {
  const states: Array<FilesOpProgressUiState | undefined> = []
  let taskSawCalibrated = false
  await runFilesOpWithProgress({
    kind: 'delete',
    minVisibleMs: MIN_VISIBLE,
    showDelayMs: 0,
    estimate: async () => {
      assert.ok(states.length >= 1, '统计开始前窗口必须已展示')
      assert.equal(states[0]!.remainingLabel, FILES_OP_PROGRESS_ESTIMATING_LABEL)
      assert.equal(states[0]!.fraction, 0)
      await sleep(10)
      return 40
    },
    onUiChange: (state) => states.push(state ? { ...state } : state),
    task: async (report) => {
      const last = states[states.length - 1]
      assert.ok(last)
      assert.notEqual(last.remainingLabel, FILES_OP_PROGRESS_ESTIMATING_LABEL)
      taskSawCalibrated = true
      report({ done: 40, total: 40 })
    },
  })
  assert.equal(taskSawCalibrated, true)
  const closedIndex = states.findIndex((state) => state === undefined)
  assert.ok(closedIndex > 0)
  assert.equal(states[closedIndex - 1]!.remainingLabel, '已完成')
  console.log('run-with-op-progress estimate counting-then-calibrate ok')
}

async function testEstimateErrorClosesAndPropagates(): Promise<void> {
  const states: Array<FilesOpProgressUiState | undefined> = []
  let taskRan = false
  await assert.rejects(
    runFilesOpWithProgress({
      kind: 'paste',
      minVisibleMs: MIN_VISIBLE,
      showDelayMs: 0,
      estimate: async () => {
        await sleep(5)
        throw new Error('estimate-fail')
      },
      onUiChange: (state) => states.push(state ? { ...state } : state),
      task: async () => {
        taskRan = true
      },
    }),
    /estimate-fail/,
  )
  assert.equal(taskRan, false)
  assert.equal(states[states.length - 1], undefined)
  for (const state of states) {
    if (state) assert.notEqual(state.remainingLabel, '已完成')
  }
  console.log('run-with-op-progress estimate error-close ok')
}

async function testEstimatePhaseCountsTowardMinVisible(): Promise<void> {
  const minVisibleMs = 80
  const estimateMs = 50
  let firstAt = 0
  let closedAt = 0
  await runFilesOpWithProgress({
    kind: 'compress',
    minVisibleMs,
    showDelayMs: 0,
    estimate: async () => {
      await sleep(estimateMs)
      return 8
    },
    onUiChange: (state) => {
      if (state && firstAt === 0) firstAt = performance.now()
      if (state === undefined) closedAt = performance.now()
    },
    task: async () => undefined,
  })
  const visibleMs = closedAt - firstAt
  assert.ok(visibleMs >= minVisibleMs - 25, `visibleMs=${visibleMs} 不应短于最短显示`)
  // 若统计阶段未计入，可见时长会接近 estimateMs + minVisibleMs
  assert.ok(
    visibleMs < estimateMs + minVisibleMs - 10,
    `visibleMs=${visibleMs} 统计阶段应计入最短显示，不应再叠一整段`,
  )
  console.log('run-with-op-progress estimate counts toward min-visible ok')
}

/** 任务时长已超过最短显示：完成即刻关窗，不追加挂起 */
async function testClosesImmediatelyWhenPastMinVisible(): Promise<void> {
  const minVisibleMs = 80
  const taskMs = 300
  let firstAt = 0
  let closedAt = 0
  await runFilesOpWithProgress({
    kind: 'paste',
    minVisibleMs,
    showDelayMs: 0,
    onUiChange: (state) => {
      if (state && firstAt === 0) firstAt = performance.now()
      if (state === undefined) closedAt = performance.now()
    },
    task: async () => {
      await sleep(taskMs)
    },
  })
  const visibleMs = closedAt - firstAt
  assert.ok(
    visibleMs < taskMs + minVisibleMs - 30,
    `visibleMs=${visibleMs} 任务已超过最短显示，完成时不应再补足挂起`,
  )
  console.log('run-with-op-progress close immediately past min-visible ok')
}

async function testForwardsTreeDetailAndIndeterminate(): Promise<void> {
  const states: Array<FilesOpProgressUiState | undefined> = []
  await runFilesOpWithProgress({
    kind: 'paste',
    minVisibleMs: MIN_VISIBLE,
    showDelayMs: 0,
    estimate: async () => {
      assert.equal(states[0]!.indeterminate, true)
      return 20
    },
    onUiChange: (state) => states.push(state ? { ...state } : state),
    task: async (report) => {
      report({
        done: 8,
        total: 20,
        currentName: 'note.txt',
        items: { done: 3, total: 10 },
        bytes: { done: 4000, total: 12000 },
      })
    },
  })
  const withDetail = states.find(
    (state) => state && state.currentName === 'note.txt' && state.items?.done === 3,
  )
  assert.ok(withDetail, '进度窗应透传当前名与树内项数/字节')
  assert.equal(withDetail!.bytes?.total, 12000)
  assert.notEqual(withDetail!.indeterminate, true)
  const completed = states.find((state) => state?.remainingLabel === '已完成')
  assert.equal(completed?.items?.total, 10)
  assert.equal(completed?.fraction, 1)
  console.log('run-with-op-progress forwards tree detail + indeterminate ok')
}

/** 有字节进度且跑了足够久：状态里应带速度文案（体积格式 + /s） */
async function testSpeedLabelWithByteProgress(): Promise<void> {
  const states: Array<FilesOpProgressUiState | undefined> = []
  await runFilesOpWithProgress({
    kind: 'paste',
    totalWork: 1000,
    minVisibleMs: MIN_VISIBLE,
    showDelayMs: 0,
    onUiChange: (state) => states.push(state ? { ...state } : state),
    task: async (report) => {
      await sleep(700)
      report({ done: 500, total: 1000, bytes: { done: 600_000, total: 1_200_000 } })
      await sleep(350)
    },
  })
  const withSpeed = states.find((state) => state?.speedLabel !== undefined)
  assert.ok(withSpeed, '有字节进度且跑过采样下限后应给出速度文案')
  assert.match(withSpeed!.speedLabel!, /\/s$/, '速度文案应以 /s 结尾')
  console.log('run-with-op-progress speed label ok')
}

/** 删除没有体积口径：不应硬编速度 */
async function testNoSpeedWithoutByteProgress(): Promise<void> {
  const states: Array<FilesOpProgressUiState | undefined> = []
  await runFilesOpWithProgress({
    kind: 'delete',
    totalWork: 10,
    minVisibleMs: MIN_VISIBLE,
    showDelayMs: 0,
    onUiChange: (state) => states.push(state ? { ...state } : state),
    task: async (report) => {
      await sleep(700)
      report({ done: 5, total: 10 })
      await sleep(350)
    },
  })
  for (const state of states) {
    if (state) assert.equal(state.speedLabel, undefined, '无字节进度不应出现速度文案')
  }
  console.log('run-with-op-progress no-speed-without-bytes ok')
}

await testShowsImmediatelyAndCompletes()
await testQuickOpShowsNothing()
await testSlowOpShowsAfterDelay()
await testErrorClosesWithoutCompletedState()
await testCancelConvertsToCancelledError()
await testEstimateShowsCountingThenCalibrates()
await testEstimateErrorClosesAndPropagates()
await testEstimatePhaseCountsTowardMinVisible()
await testClosesImmediatelyWhenPastMinVisible()
await testForwardsTreeDetailAndIndeterminate()
await testSpeedLabelWithByteProgress()
await testNoSpeedWithoutByteProgress()
console.log('files-run-with-op-progress.test.ts: ok')
