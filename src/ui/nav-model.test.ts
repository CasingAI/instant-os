/**
 * 宽屏帧转场窗口的下标匹配：-1 是「没有这一侧」，不是「查不到」。
 * 运行：node --experimental-strip-types src/ui/nav-model.test.ts
 */
import assert from 'node:assert/strict'
import { hitsNavFrameIndex, wideNavFrameIndices, wideNavExitingIds, wideNavPage } from './nav-model.ts'

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

{
  const oldFrames = ['keys', 'b:0']
  assert.deepEqual(wideNavExitingIds(['keys'], oldFrames, 2, [], false), ['b:0'])
  assert.deepEqual(wideNavExitingIds(['keys'], oldFrames, 1, ['b:0'], false), ['b:0'])
  assert.deepEqual(wideNavExitingIds(['keys'], ['keys'], 1, [], false), [])
  assert.deepEqual(wideNavExitingIds(['keys'], oldFrames, 2, ['b:0'], true), [])
  assert.deepEqual(wideNavExitingIds([], oldFrames, 2, [], false), [])
  assert.deepEqual(wideNavExitingIds(oldFrames, oldFrames, 1, ['b:0'], false), [])

  const oldPage = { title: '新闻', body: '旧内容', backLabel: '返回' }
  const emptyPage = { title: '注册表管理', body: '', backLabel: '' }
  const previous = new Map([['b:0', oldPage]])
  let renders = 0
  const render = () => { renders++; return emptyPage }
  assert.equal(wideNavPage('b:0', true, previous, render), oldPage)
  assert.equal(renders, 0, '退出页不能用清空后的应用状态重新生成')
  assert.equal(wideNavPage('b:0', false, previous, render), emptyPage)
  assert.equal(renders, 1, '重新进入相同 id 必须渲染最新内容')
  assert.equal(wideNavPage('edit', true, previous, render), emptyPage)
}

console.log('nav-model: ok')
