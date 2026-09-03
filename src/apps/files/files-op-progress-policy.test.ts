/**
 * 进度策略单测：工作量折算、剩余时间估算与文案、进度折算。
 * 观察窗/ETA 门槛已移除——进度窗现在立即展示，只保留最短显示时长。
 * 运行：node --experimental-strip-types src/apps/files/files-op-progress-policy.test.ts
 */
import assert from 'node:assert/strict'
import {
  estimateFilesOpDurationMs,
  estimateRemainingMs,
  filesOpProgressFraction,
  filesWorkloadUnits,
  formatFilesOpRemainingLabel,
  FILES_OP_PROGRESS_MIN_VISIBLE_MS,
} from './files-op-progress-policy.ts'

{
  // 剩余估算仍有实测吞吐与总时长预估两条路径（用于「大约还要 X 秒」文案）
  const byRate = estimateRemainingMs({ done: 10, total: 100, elapsedMs: 500 })
  assert.ok(byRate > 0 && Number.isFinite(byRate), `byRate=${byRate}`)
  assert.equal(estimateRemainingMs({ done: 100, total: 100, elapsedMs: 350 }), 0)
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
  // 最短显示时长保留防闪烁垫底：极快操作不至于一闪而过，但不再长时间压窗
  assert.ok(FILES_OP_PROGRESS_MIN_VISIBLE_MS >= 800)
}

console.log('files-op-progress-policy.test.ts: ok')
