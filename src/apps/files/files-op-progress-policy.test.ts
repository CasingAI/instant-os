/**
 * 运行：node --experimental-strip-types src/apps/files/files-op-progress-policy.test.ts
 */
import assert from 'node:assert/strict'
import {
  estimateFilesOpDurationMs,
  estimateRemainingMs,
  filesOpProgressFraction,
  filesWorkloadUnits,
  formatFilesOpRemainingLabel,
  FILES_OP_PROGRESS_SHOW_IF_REMAINING_MS,
  shouldShowFilesOpProgressAtObserve,
} from './files-op-progress-policy.ts'

{
  assert.equal(shouldShowFilesOpProgressAtObserve({ done: 100, total: 100, elapsedMs: 1000 }), false)
}

{
  const snapshot = { done: 10, total: 100, elapsedMs: 1000, estimatedTotalMs: 9000 }
  const remaining = estimateRemainingMs(snapshot)
  assert.ok(remaining >= FILES_OP_PROGRESS_SHOW_IF_REMAINING_MS)
  assert.equal(shouldShowFilesOpProgressAtObserve(snapshot), true)
}

{
  const snapshot = { done: 90, total: 100, elapsedMs: 1000, estimatedTotalMs: 1100 }
  const remaining = estimateRemainingMs(snapshot)
  assert.ok(remaining < FILES_OP_PROGRESS_SHOW_IF_REMAINING_MS)
  assert.equal(shouldShowFilesOpProgressAtObserve(snapshot), false)
}

{
  const snapshot = { done: 0, total: 100, elapsedMs: 1000, estimatedTotalMs: 12_000 }
  assert.equal(shouldShowFilesOpProgressAtObserve(snapshot), true)
}

{
  assert.equal(formatFilesOpRemainingLabel(8000), '大约还要 8 秒')
  assert.equal(formatFilesOpRemainingLabel(90_000), '大约还要 2 分钟')
  assert.equal(formatFilesOpRemainingLabel(Number.POSITIVE_INFINITY), '正在估算剩余时间…')
  assert.equal(formatFilesOpRemainingLabel(3_145_734), '大约还要 53 分钟')
  assert.equal(formatFilesOpRemainingLabel(12_884_901_888), '大约还要超过 1 天')
}

{
  const twoGiB = 2_147_483_648
  const units = filesWorkloadUnits(1, twoGiB)
  const durationMs = estimateFilesOpDurationMs(units)
  assert.ok(durationMs < 60 * 60 * 1000, '2GiB 应按工作量估时，不能到小时级以上')
  assert.ok(estimateFilesOpDurationMs(twoGiB) > 24 * 60 * 60 * 1000)
}

{
  assert.equal(filesOpProgressFraction(25, 100), 0.25)
  assert.equal(filesOpProgressFraction(150, 100), 1)
}

{
  const totalUnits = 2000
  assert.ok(estimateFilesOpDurationMs(totalUnits) >= FILES_OP_PROGRESS_SHOW_IF_REMAINING_MS + 1000)
}

console.log('files-op-progress-policy.test.ts: ok')
