/**
 * 背景刷新到期退避单测。
 * 运行：node --experimental-strip-types src/os/background-refresh-settings-storage.test.ts
 */
import assert from 'node:assert/strict'
import { msUntilTaskDueFromState } from './background-refresh-settings-storage.ts'

const HOUR_MS = 60 * 60 * 1000
const intervalHours = 24
const now = 1_700_000_000_000

{
  const remaining = msUntilTaskDueFromState(
    { lastAttemptAt: 0, lastSuccessAt: 0 },
    intervalHours,
    now,
  )
  assert.equal(remaining, 0, '从未尝试过应立即到期')
}

{
  const justFailed = now - 1_000
  const remaining = msUntilTaskDueFromState(
    { lastAttemptAt: justFailed, lastSuccessAt: 0 },
    intervalHours,
    now,
  )
  assert.ok(remaining > 0, '刚失败且从未成功不应立即再到期')
  assert.equal(remaining, justFailed + intervalHours * HOUR_MS - now)
}

{
  const lastRun = now - intervalHours * HOUR_MS
  const remaining = msUntilTaskDueFromState(
    { lastAttemptAt: lastRun, lastSuccessAt: lastRun },
    intervalHours,
    now,
  )
  assert.equal(remaining, 0, '上次尝试已满间隔应到期')
}

{
  const lastSuccess = now - intervalHours * HOUR_MS
  const lastAttempt = now - 60_000
  const remaining = msUntilTaskDueFromState(
    { lastAttemptAt: lastAttempt, lastSuccessAt: lastSuccess },
    intervalHours,
    now,
  )
  assert.ok(remaining > 0, '失败比成功更近时应按 lastAttemptAt 退避')
  assert.equal(remaining, lastAttempt + intervalHours * HOUR_MS - now)
}

console.log('background-refresh-settings-storage.test.ts ok')
