/**
 * 文件管理器多选纯函数单测。
 * 运行：node --experimental-strip-types src/apps/files/files-selection.test.ts
 */
import assert from 'node:assert/strict'
import {
  marqueeSelection,
  rangeSelection,
  rectsIntersect,
  toggleInSet,
} from './files-selection.ts'

const ORDER = ['a', 'b', 'c', 'd', 'e']

function testRangeSelection(): void {
  assert.deepEqual([...rangeSelection(ORDER, 'b', 'd')], ['b', 'c', 'd'])
  assert.deepEqual([...rangeSelection(ORDER, 'd', 'b')], ['b', 'c', 'd'])
  assert.deepEqual([...rangeSelection(ORDER, 'c', 'c')], ['c'])
  // anchor 不在列表：退化为单选 target
  assert.deepEqual([...rangeSelection(ORDER, 'zz', 'c')], ['c'])
  assert.deepEqual([...rangeSelection(ORDER, undefined, 'a')], ['a'])
  // target 不在列表：仅加入 target
  assert.deepEqual([...rangeSelection(ORDER, 'b', 'zz')], ['zz'])
  assert.deepEqual([...rangeSelection([], undefined, 'x')], ['x'])
  console.log('ok: rangeSelection')
}

function testRectsIntersect(): void {
  assert.equal(
    rectsIntersect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      { left: 5, top: 5, right: 15, bottom: 15 },
    ),
    true,
  )
  assert.equal(
    rectsIntersect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      { left: 20, top: 20, right: 30, bottom: 30 },
    ),
    false,
  )
  // 边重合视为相交
  assert.equal(
    rectsIntersect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      { left: 10, top: 0, right: 20, bottom: 10 },
    ),
    true,
  )
  // 完全包含
  assert.equal(
    rectsIntersect(
      { left: 2, top: 2, right: 8, bottom: 8 },
      { left: 0, top: 0, right: 10, bottom: 10 },
    ),
    true,
  )
  console.log('ok: rectsIntersect')
}

function testMarqueeSelection(): void {
  const entries = [
    { id: 'a', rect: { left: 0, top: 0, right: 10, bottom: 10 } },
    { id: 'b', rect: { left: 20, top: 0, right: 30, bottom: 10 } },
    { id: 'c', rect: { left: 0, top: 20, right: 10, bottom: 30 } },
  ]
  // 框住 a
  assert.deepEqual(marqueeSelection(entries, { left: 2, top: 2, right: 8, bottom: 8 }), ['a'])
  // 框住 a 与 c（跨两行）
  assert.deepEqual(marqueeSelection(entries, { left: 2, top: 2, right: 8, bottom: 28 }), ['a', 'c'])
  // 反方向拖拽（right < left）
  assert.deepEqual(marqueeSelection(entries, { left: 8, top: 2, right: 2, bottom: 8 }), ['a'])
  // 与 b 相交
  assert.deepEqual(marqueeSelection(entries, { left: 25, top: 0, right: 40, bottom: 5 }), ['b'])
  // 空框（误触）不选中
  assert.deepEqual(marqueeSelection(entries, { left: 5, top: 5, right: 5, bottom: 5 }), [])
  // 不相关区域
  assert.deepEqual(marqueeSelection(entries, { left: 50, top: 50, right: 60, bottom: 60 }), [])
  console.log('ok: marqueeSelection')
}

function testToggleInSet(): void {
  const base = new Set(['a', 'b'])
  assert.deepEqual([...toggleInSet(base, 'c')].sort(), ['a', 'b', 'c'])
  assert.deepEqual([...toggleInSet(base, 'a')], ['b'])
  // 原集合不被修改
  assert.deepEqual([...base], ['a', 'b'])
  console.log('ok: toggleInSet')
}

testRangeSelection()
testRectsIntersect()
testMarqueeSelection()
testToggleInSet()
console.log('files-selection tests passed')
