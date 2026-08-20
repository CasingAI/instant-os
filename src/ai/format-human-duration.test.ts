/**
 * 中文时长格式化单测。
 * 运行：node --experimental-strip-types src/ai/format-human-duration.test.ts
 */
import assert from 'node:assert/strict'
import {
  formatHumanDurationMs,
  formatThinkingDurationMs,
} from './format-human-duration.ts'

assert.equal(formatHumanDurationMs(500), '不到 1 秒')
assert.equal(formatHumanDurationMs(1500), '1.5 秒')
assert.equal(formatHumanDurationMs(12_500), '13 秒')
assert.equal(formatHumanDurationMs(90_000), '1 分 30 秒')
assert.equal(formatHumanDurationMs(125_000), '2 分 5 秒')
assert.equal(formatHumanDurationMs(120_000), '2 分')
assert.equal(formatHumanDurationMs(3_600_000), '1 小时')
assert.equal(formatHumanDurationMs(3_665_000), '1 小时 1 分 5 秒')

assert.equal(formatThinkingDurationMs(500), '思考了不到 1 秒')
assert.equal(formatThinkingDurationMs(90_000), '思考了 1 分 30 秒')

console.log('format-human-duration.test.ts: ok')
