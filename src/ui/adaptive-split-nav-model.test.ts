/**
 * 宽屏帧转场窗口的下标匹配：-1 是「没有这一侧」，不是「查不到」。
 * 运行：node --experimental-strip-types src/ui/adaptive-split-nav-model.test.ts
 */
import assert from 'node:assert/strict'
import { hitsNavFrameIndex, wideNavFrameIndices } from './adaptive-split-nav-model.ts'

// 从列表点进首个子页：只有一帧（active=0），push 的 under 侧下标是 -1。
// 左栏列表 host 的 indexOf 也是 -1，绝不允许因此命中 under。
{
  const { navUnder, navOver } = wideNavFrameIndices('push', 0)
  assert.equal(navUnder, -1)
  assert.equal(navOver, 0)
  assert.equal(hitsNavFrameIndex(-1, navUnder), false, '不在帧序列里的页不得标 under')
  assert.equal(hitsNavFrameIndex(-1, navOver), false, '不在帧序列里的页不得标 over')
  assert.equal(hitsNavFrameIndex(0, navUnder), false)
  assert.equal(hitsNavFrameIndex(0, navOver), true, '唯一帧是 push 的顶层')
}

// 已展开一本书再点进卷/章：两帧，旧帧退守、新帧滑入。
{
  const { navUnder, navOver } = wideNavFrameIndices('push', 1)
  assert.equal(navUnder, 0)
  assert.equal(navOver, 1)
  assert.equal(hitsNavFrameIndex(-1, navUnder), false, '左栏列表不得参与帧转场')
  assert.equal(hitsNavFrameIndex(0, navUnder), true)
  assert.equal(hitsNavFrameIndex(1, navOver), true)
}

// 逐级返回：新顶回位、退场帧滑出。
{
  const { navUnder, navOver } = wideNavFrameIndices('pop', 0)
  assert.equal(navUnder, 0)
  assert.equal(navOver, 1)
  assert.equal(hitsNavFrameIndex(-1, navUnder), false)
  assert.equal(hitsNavFrameIndex(-1, navOver), false)
  assert.equal(hitsNavFrameIndex(0, navUnder), true)
  assert.equal(hitsNavFrameIndex(1, navOver), true)
}

// 没有窗口：两侧都是 -1，什么都匹配不上。
{
  const { navUnder, navOver } = wideNavFrameIndices(undefined, 1)
  assert.equal(navUnder, -1)
  assert.equal(navOver, -1)
  assert.equal(hitsNavFrameIndex(0, navUnder), false)
  assert.equal(hitsNavFrameIndex(1, navOver), false)
}

console.log('adaptive-split-nav-model: ok')
