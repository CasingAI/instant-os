/**
 * Flip 3D 叠层：transform 方向与窗口队列循环。
 * 运行：node --experimental-strip-types src/window/build-flip3d-transform.test.ts
 */
import assert from 'node:assert/strict'
import { computeFlip3dFlyOutParts, computeFlip3dTransformParts } from './build-flip3d-transform.ts'
import {
  bringFlip3dWindowToFront,
  commitFlip3dCycle,
  cycleFlip3dOrder,
  isFlip3dEligibleWindow,
  listFlip3dWindowIds,
  resolveFlip3dVisual,
} from './flip3d.ts'
import type { WindowState } from '../os/types.ts'

const VIEWPORT = { width: 1280, height: 800 }
const BOUNDS = { x: 100, y: 80, width: 640, height: 480 }

function makeWindow(id: string, partial: Partial<WindowState> = {}): WindowState {
  return {
    id,
    appId: 'files',
    title: 't',
    minimized: false,
    maximized: false,
    fullscreen: false,
    zIndex: 1,
    x: 0,
    y: 0,
    width: 400,
    height: 600,
    ...partial,
  }
}

function testRankRecedesUpAndLeft(): void {
  const front = computeFlip3dTransformParts(BOUNDS, 0, VIEWPORT)
  const back = computeFlip3dTransformParts(BOUNDS, 1, VIEWPORT)
  assert.ok(front.rotateY > 0, '右缘朝镜头，后窗才能从左侧露出内容')
  assert.ok(back.translateZ < front.translateZ, '后窗应更远离镜头')
  assert.ok(front.translateX - back.translateX > 150, '左右间距要够扇开，不能叠成一条边')
  assert.ok(front.translateY - back.translateY > 60, '后窗应明显更靠上')
  assert.equal(front.rotateY, back.rotateY)
  console.log('ok: flip3d rank recedes')
}

function testCycleOrder(): void {
  assert.deepEqual(cycleFlip3dOrder(['a', 'b', 'c'], 1), ['b', 'c', 'a'])
  assert.deepEqual(cycleFlip3dOrder(['a', 'b', 'c'], -1), ['c', 'a', 'b'])
  assert.deepEqual(cycleFlip3dOrder(['only'], 1), ['only'])
  console.log('ok: flip3d cycle order')
}

function testCommitCycle(): void {
  const order = ['a', 'b', 'c']
  assert.deepEqual(
    commitFlip3dCycle(order, { flyingId: 'a', direction: 1, phase: 'out' }),
    ['b', 'c', 'a'],
  )
  assert.deepEqual(
    commitFlip3dCycle(['b', 'c', 'a'], { flyingId: 'a', direction: 1, phase: 'in' }),
    ['b', 'c', 'a'],
  )
  assert.deepEqual(
    commitFlip3dCycle(order, { flyingId: 'c', direction: -1, phase: 'teleport' }),
    ['c', 'a', 'b'],
  )
  assert.deepEqual(commitFlip3dCycle(order, undefined), order)
  assert.deepEqual(
    commitFlip3dCycle(order, { flyingId: '', direction: 1, phase: 'snap' }),
    order,
  )
  console.log('ok: flip3d commit cycle')
}

function testBringToFront(): void {
  assert.deepEqual(bringFlip3dWindowToFront(['a', 'b', 'c'], 'c'), ['c', 'a', 'b'])
  assert.deepEqual(bringFlip3dWindowToFront(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
  assert.deepEqual(bringFlip3dWindowToFront(['a', 'b', 'c'], 'a'), ['a', 'b', 'c'])
  assert.deepEqual(bringFlip3dWindowToFront(['a', 'b', 'c'], 'missing'), ['a', 'b', 'c'])
  console.log('ok: flip3d bring to front')
}

function testCycleVisual(): void {
  const order = ['a', 'b', 'c']
  const out = resolveFlip3dVisual(order, 'a', { flyingId: 'a', direction: 1, phase: 'out' })
  const next = resolveFlip3dVisual(order, 'b', { flyingId: 'a', direction: 1, phase: 'out' })
  assert.equal(out?.flyOut, true)
  assert.equal(out?.opacity, 0)
  assert.equal(next?.rank, 0)
  assert.equal(next?.flyOut, false)

  const cycled = ['b', 'c', 'a']
  const teleport = resolveFlip3dVisual(cycled, 'a', {
    flyingId: 'a',
    direction: 1,
    phase: 'teleport',
  })
  assert.equal(teleport?.rank, 2)
  assert.equal(teleport?.skipTransition, true)
  assert.equal(teleport?.opacity, 0)
  assert.equal(teleport?.flyOut, false)

  const snap = resolveFlip3dVisual(cycled, 'a', {
    flyingId: '',
    direction: 1,
    phase: 'snap',
  })
  assert.equal(snap?.rank, 2)
  assert.equal(snap?.skipTransition, true)
  assert.equal(snap?.flyOut, false)
  assert.equal(snap?.opacity, 1)
  console.log('ok: flip3d cycle visual')
}

function testFlyOutGoesRight(): void {
  const rest = computeFlip3dTransformParts(BOUNDS, 0, VIEWPORT)
  const fly = computeFlip3dFlyOutParts(BOUNDS, VIEWPORT)
  assert.ok(fly.translateX > rest.translateX, '掠过时应往右飞出')
  console.log('ok: flip3d fly-out right')
}

function testEligibleWindows(): void {
  const windows = [
    makeWindow('front', { zIndex: 5 }),
    makeWindow('min', { zIndex: 9, minimized: true }),
    makeWindow('closing', { zIndex: 8, closing: true }),
    makeWindow('hidden-windowless', { zIndex: 7, windowless: true }),
    makeWindow('panel', { zIndex: 4, windowless: true, windowlessPanel: true }),
    makeWindow('back', { zIndex: 2 }),
  ]
  assert.equal(isFlip3dEligibleWindow(windows[1]!), false)
  assert.deepEqual(listFlip3dWindowIds(windows), ['front', 'panel', 'back'])
  console.log('ok: flip3d eligible windows')
}

function main(): void {
  testRankRecedesUpAndLeft()
  testCycleOrder()
  testCommitCycle()
  testBringToFront()
  testCycleVisual()
  testFlyOutGoesRight()
  testEligibleWindows()
  console.log('all flip3d tests passed')
}

main()
