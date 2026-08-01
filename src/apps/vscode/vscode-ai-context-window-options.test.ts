/**
 * 上下文长度选项：标签、过近合并、按模型过滤。
 * 运行：node --experimental-strip-types --test src/apps/vscode/vscode-ai-context-window-options.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildVscodeAiContextWindowManualPresets,
  formatContextWindowTokenLabel,
  mergeNearContextWindowPresets,
} from './vscode-ai-context-window-options.ts'

/** 与 vscode-prefs VSCODE_AI_CONTEXT_WINDOW_PRESETS 对齐（避免导入 monaco） */
const CATALOG = [
  64_000, 128_000, 200_000, 256_000, 400_000, 1_000_000,
] as const

assert.equal(formatContextWindowTokenLabel(200_000), '200K')
assert.equal(formatContextWindowTokenLabel(1_000_000), '1M')
assert.equal(formatContextWindowTokenLabel(1_050_000), '1.1M')
assert.notEqual(
  formatContextWindowTokenLabel(1_000_000),
  formatContextWindowTokenLabel(1_050_000),
)

assert.deepEqual(
  mergeNearContextWindowPresets([200_000, 256_000], 1_000_000, 256_000),
  [256_000],
)
assert.deepEqual(
  mergeNearContextWindowPresets([200_000, 256_000], 200_000, 200_000),
  [200_000],
)
assert.deepEqual(
  mergeNearContextWindowPresets(
    [64_000, 128_000, 200_000, 256_000, 400_000, 1_000_000],
    1_000_000,
    1_000_000,
  ),
  [64_000, 128_000, 256_000, 400_000, 1_000_000],
)
assert.deepEqual(
  mergeNearContextWindowPresets([1_000_000, 1_050_000], 1_050_000, 1_050_000),
  [1_050_000],
)

{
  // GPT-5.4：系统 1.05M；手动无第二假 1M / 无 512K
  const manual = buildVscodeAiContextWindowManualPresets({
    systemTokens: 1_050_000,
    catalog: CATALOG,
    presetTokens: 1_050_000,
  })
  assert.ok(!manual.includes(1_050_000))
  assert.ok(!manual.includes(512_000))
  assert.ok(manual.includes(1_000_000))
  assert.equal(
    formatContextWindowTokenLabel(1_050_000),
    '1.1M',
  )
  const labels = [
    `使用系统值（${formatContextWindowTokenLabel(1_050_000)}）`,
    ...manual.map(formatContextWindowTokenLabel),
  ]
  assert.equal(new Set(labels).size, labels.length)
}

{
  // MiMo V2.5：系统 1M；200K/256K 不同时出现
  const manual = buildVscodeAiContextWindowManualPresets({
    systemTokens: 1_000_000,
    catalog: CATALOG,
    presetTokens: 1_000_000,
  })
  assert.ok(!manual.includes(512_000))
  assert.ok(!manual.includes(1_050_000))
  assert.ok(!(manual.includes(200_000) && manual.includes(256_000)))
  assert.ok(manual.includes(256_000))
}

{
  // MiniMax M2.7：系统 200K，不应出现 256K/400K
  const manual = buildVscodeAiContextWindowManualPresets({
    systemTokens: 200_000,
    catalog: CATALOG,
    presetTokens: 200_000,
  })
  assert.deepEqual(manual, [64_000, 128_000, 200_000])
}

{
  // 历史覆盖临时插入，再经过近合并
  const manual = buildVscodeAiContextWindowManualPresets({
    systemTokens: 1_050_000,
    catalog: CATALOG,
    presetTokens: 1_050_000,
    currentOverride: 1_050_000,
  })
  assert.deepEqual(manual, [
    64_000,
    128_000,
    256_000,
    400_000,
    1_050_000,
  ])
}

console.log('vscode-ai-context-window-options.test.ts: ok')
