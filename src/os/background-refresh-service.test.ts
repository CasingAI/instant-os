/**
 * 背景刷新调度不得同步重入。
 * 运行：node --experimental-strip-types src/os/background-refresh-service.test.ts
 */
import assert from 'node:assert/strict'
import { DEVICE_STORAGE_KEYS } from './device-storage.ts'
import {
  patchBackgroundRefreshTaskState,
  subscribeBackgroundRefreshSettings,
} from './background-refresh-settings-storage.ts'
import {
  installBackgroundRefreshTaskRunnerForTests,
  resetBackgroundRefreshServiceForTests,
  runBackgroundRefreshTask,
  startBackgroundRefreshService,
} from './background-refresh-service.ts'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}

class FakeWindow extends EventTarget {
  setInterval(handler: TimerHandler, timeout?: number): ReturnType<typeof setInterval> {
    return globalThis.setInterval(handler, timeout)
  }

  clearInterval(id: ReturnType<typeof setInterval>): void {
    globalThis.clearInterval(id)
  }
}

const memoryStorage = new MemoryStorage()
const fakeWindow = new FakeWindow()
;(globalThis as { localStorage?: Storage }).localStorage = memoryStorage
;(globalThis as { window?: FakeWindow }).window = fakeWindow

async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve()
  }
}

function restoreRunners(restorers: Array<() => void>): void {
  while (restorers.length > 0) {
    restorers.pop()?.()
  }
}

{
  memoryStorage.clear()
  resetBackgroundRefreshServiceForTests()
  const restorers: Array<() => void> = []
  let modelPricingRuns = 0

  restorers.push(
    installBackgroundRefreshTaskRunnerForTests('model-pricing', async () => {
      modelPricingRuns += 1
      if (modelPricingRuns > 20) {
        throw new Error('model-pricing runner looped')
      }
      // 旧缺陷：失败只写 lastResult，不写 lastAttemptAt，任务仍永远到期
      patchBackgroundRefreshTaskState('model-pricing', { lastResult: 'failure' })
      return { ok: false, updatedCount: 0, message: 'simulated failure' }
    }),
  )
  restorers.push(
    installBackgroundRefreshTaskRunnerForTests('openrouter-model-pricing', async () => {
      return { ok: true, updatedCount: 0, message: 'skip' }
    }),
  )

  // 旧调度：每次设置回写都立刻再跑任务（设置页订阅后即是这条链）
  const unsubscribe = subscribeBackgroundRefreshSettings(() => {
    void runBackgroundRefreshTask('model-pricing')
  })

  const stop = startBackgroundRefreshService()
  try {
    await flushMicrotasks()
    assert.ok(
      modelPricingRuns <= 2,
      `自动巡检在失败未写 lastAttemptAt 时不得连打，实际 ${modelPricingRuns} 次`,
    )
  } finally {
    unsubscribe()
    stop()
    restoreRunners(restorers)
    resetBackgroundRefreshServiceForTests()
    memoryStorage.removeItem(DEVICE_STORAGE_KEYS.backgroundRefreshSettings)
    memoryStorage.removeItem(DEVICE_STORAGE_KEYS.modelPricingCache)
  }
}

{
  memoryStorage.clear()
  resetBackgroundRefreshServiceForTests()
  const restorers: Array<() => void> = []
  let modelPricingRuns = 0

  restorers.push(
    installBackgroundRefreshTaskRunnerForTests('model-pricing', async () => {
      modelPricingRuns += 1
      if (modelPricingRuns > 20) {
        throw new Error('forced runner looped')
      }
      patchBackgroundRefreshTaskState('model-pricing', { lastResult: 'failure' })
      return { ok: false, updatedCount: 0, message: 'simulated failure' }
    }),
  )
  restorers.push(
    installBackgroundRefreshTaskRunnerForTests('openrouter-model-pricing', async () => {
      return { ok: true, updatedCount: 0, message: 'skip' }
    }),
  )

  try {
    await runBackgroundRefreshTask('model-pricing')
    await runBackgroundRefreshTask('model-pricing')
    assert.equal(modelPricingRuns, 1, '自动路径在冷却期内不得连打')
    await runBackgroundRefreshTask('model-pricing', { force: true })
    assert.equal(modelPricingRuns, 2, '立即刷新应绕过自动冷却')
  } finally {
    restoreRunners(restorers)
    resetBackgroundRefreshServiceForTests()
    memoryStorage.removeItem(DEVICE_STORAGE_KEYS.backgroundRefreshSettings)
  }
}

console.log('background-refresh-service.test.ts ok')
