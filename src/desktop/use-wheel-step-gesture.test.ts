/**
 * 触控板 wheel 步进：主轴选择与「滑一次切一次」锁/波谷。
 * 运行：node --experimental-strip-types src/desktop/use-wheel-step-gesture.test.ts
 */
import assert from 'node:assert/strict'
import {
  applyWheelStepDelta,
  createWheelStepGestureState,
  dominantWheelDelta,
  flip3dWheelDelta,
  horizontalWheelDelta,
  WHEEL_MIN_LOCK_MS,
  WHEEL_PAGE_THRESHOLD,
  WHEEL_REFIRE_IMPULSE,
  WHEEL_SETTLE_DELTA,
} from './use-wheel-step-gesture.ts'

function testDominantAxisPicksLargerAbs(): void {
  assert.equal(dominantWheelDelta(30, 10), 30)
  assert.equal(dominantWheelDelta(-30, 10), -30)
  assert.equal(dominantWheelDelta(10, 30), 30)
  assert.equal(dominantWheelDelta(10, -30), -30)
  assert.equal(dominantWheelDelta(20, 20), 20)
  assert.equal(dominantWheelDelta(-20, 20), -20)
  assert.equal(dominantWheelDelta(0, 0), 0)
  console.log('ok: dominant axis picks larger abs')
}

function testFlip3dDeltaFollowsFinger(): void {
  assert.equal(flip3dWheelDelta(30, 10), -30)
  assert.equal(flip3dWheelDelta(-30, 10), 30)
  assert.equal(flip3dWheelDelta(10, 30), -30)
  assert.equal(flip3dWheelDelta(10, -30), 30)
  assert.equal(flip3dWheelDelta(0, 0), 0)
  console.log('ok: flip3d delta follows finger')
}

function testDesktopPagerStaysHorizontal(): void {
  assert.equal(horizontalWheelDelta(40, 10), 40)
  assert.equal(horizontalWheelDelta(-40, 10), -40)
  assert.equal(horizontalWheelDelta(10, 40), 0)
  assert.equal(horizontalWheelDelta(20, 20), 0)
  assert.equal(horizontalWheelDelta(0, 0), 0)
  console.log('ok: desktop pager stays horizontal')
}

function testAccumulateFiresOnce(): void {
  const state = createWheelStepGestureState()
  const now = 1000
  assert.equal(applyWheelStepDelta(state, 20, now), undefined)
  assert.equal(applyWheelStepDelta(state, 15, now + 8), undefined)
  assert.equal(applyWheelStepDelta(state, 10, now + 16), 1)
  assert.equal(
    applyWheelStepDelta(state, WHEEL_PAGE_THRESHOLD, now + 24),
    undefined,
    'same swipe inertia must not fire again',
  )
  console.log('ok: accumulate fires once')
}

function testLockBlocksUntilValleyThenRefire(): void {
  const state = createWheelStepGestureState()
  const t0 = 0
  assert.equal(applyWheelStepDelta(state, WHEEL_PAGE_THRESHOLD, t0), 1)

  assert.equal(
    applyWheelStepDelta(state, 80, t0 + 50),
    undefined,
    'lock window swallows inertia',
  )
  assert.equal(
    applyWheelStepDelta(state, 80, t0 + WHEEL_MIN_LOCK_MS),
    undefined,
    'after lock, high delta still waits for a valley',
  )
  assert.equal(
    applyWheelStepDelta(state, WHEEL_SETTLE_DELTA, t0 + WHEEL_MIN_LOCK_MS + 10),
    undefined,
  )
  assert.equal(
    applyWheelStepDelta(state, WHEEL_REFIRE_IMPULSE, t0 + WHEEL_MIN_LOCK_MS + 20),
    1,
  )
  console.log('ok: lock then valley then refire')
}

function testReverseResetsAccum(): void {
  const state = createWheelStepGestureState()
  const now = 0
  assert.equal(applyWheelStepDelta(state, 30, now), undefined)
  assert.equal(applyWheelStepDelta(state, -20, now + 8), undefined)
  assert.equal(applyWheelStepDelta(state, -25, now + 16), -1)
  console.log('ok: reverse resets accum')
}

function main(): void {
  testDominantAxisPicksLargerAbs()
  testFlip3dDeltaFollowsFinger()
  testDesktopPagerStaysHorizontal()
  testAccumulateFiresOnce()
  testLockBlocksUntilValleyThenRefire()
  testReverseResetsAccum()
  console.log('all wheel step tests passed')
}

main()
