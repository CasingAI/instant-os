/**
 * gen-boxvnt-modes 生成器单测（todo/vm-arbitrary-resolution/ §4 防漂移）。
 * 运行：node --experimental-strip-types scripts/gen-boxvnt-modes.test.ts
 *
 * 覆盖：阶梯不变量（宽度 8px 对齐、范围、排序、去重、32bpp、与基础表
 * 不重叠）、显存需求 ≤ 16MB（R9 配套）、vidmpdat.c 内嵌段与生成器输出
 * 逐条一致（改生成参数后忘记重新生成时这里红）。
 */
import assert from 'node:assert/strict'
import {
  BOXVNT_BASE_RESOLUTIONS,
  LADDER_BPP,
  LADDER_MAX_HEIGHT,
  LADDER_MAX_WIDTH,
  LADDER_MIN_HEIGHT,
  LADDER_MIN_WIDTH,
  formatLadderCFragment,
  generateLadderModes,
  ladderMaxFramebufferBytes,
  parseVidmpdatLadder,
} from './gen-boxvnt-modes.ts'

function testLadderInvariants() {
  const modes = generateLadderModes()
  assert.ok(modes.length > 500, `密阶梯应有数百项，实际 ${modes.length}`)
  const baseKeys = new Set(BOXVNT_BASE_RESOLUTIONS.map(([w, h]) => `${w}x${h}`))
  const seen = new Set<string>()
  for (const mode of modes) {
    assert.equal(mode.bpp, LADDER_BPP)
    assert.ok(mode.width >= LADDER_MIN_WIDTH && mode.width <= LADDER_MAX_WIDTH)
    assert.ok(mode.height >= LADDER_MIN_HEIGHT && mode.height <= LADDER_MAX_HEIGHT)
    assert.equal(mode.width % 8, 0, `宽度必须 8px 对齐：${mode.width}`)
    const key = `${mode.width}x${mode.height}`
    assert.ok(!seen.has(key), `重复项：${key}`)
    assert.ok(!baseKeys.has(key), `与基础表重叠：${key}`)
    seen.add(key)
  }
  for (let i = 1; i < modes.length; i++) {
    const prev = modes[i - 1]
    const curr = modes[i]
    assert.ok(
      prev.width < curr.width || (prev.width === curr.width && prev.height < curr.height),
      `排序被破坏：${prev.width}x${prev.height} 后跟 ${curr.width}x${curr.height}`,
    )
  }
  // 密度要求（R1 回退语义）：基础表 + 阶梯合起来，任何 640–2560 宽的目标
  // 都能吸附到 ≤4px 误差（640 等档位来自基础表，阶梯与其去重）。
  const combined = [
    ...BOXVNT_BASE_RESOLUTIONS.map(([w, h]) => ({ width: w, height: h })),
    ...modes,
  ]
  for (const probe of [640, 641, 1000, 1367, 1999, 2559, 2560]) {
    const nearest = combined.reduce((best, m) =>
      Math.abs(m.width - probe) < Math.abs(best.width - probe) ? m : best,
    )
    assert.ok(Math.abs(nearest.width - probe) <= 4, `探测宽 ${probe} 最近档 ${nearest.width} 误差 >4px`)
  }
}

function testMemoryBudget() {
  const maxBytes = ladderMaxFramebufferBytes(generateLadderModes())
  assert.ok(maxBytes <= 16 * 1024 * 1024, `最大显存需求 ${maxBytes} 超过 16MB`)
}

function testVidmpdatInSync() {
  const inTree = parseVidmpdatLadder()
  const generated = generateLadderModes()
  assert.deepEqual(
    inTree,
    generated,
    'vidmpdat.c 阶梯段与生成器输出不一致：node --experimental-strip-types scripts/gen-boxvnt-modes.ts',
  )
  // 片段格式也是产物的一部分（重写时保持列对齐）。
  const fragment = formatLadderCFragment(generated)
  const lines = fragment.split('\n')
  assert.equal(lines.length, generated.length)
  for (const line of lines) {
    assert.match(line, /^\s*\{\s*\d+,\s*\d+,\s*32\s*\},\s*$/)
  }
  assert.ok(lines[0].includes(String(generated[0].width)))
  assert.ok(lines[0].includes(String(generated[0].height)))
  assert.ok(!fragment.includes('NaN'))
}

testLadderInvariants()
testMemoryBudget()
testVidmpdatInSync()
console.log('gen-boxvnt-modes.test.ts ok')
