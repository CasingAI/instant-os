import { useEffect, useRef } from 'preact/hooks'

export const WHEEL_PAGE_THRESHOLD = 40
/** 切页后的最短间隔，避开同一甩动前半段的连触发。 */
export const WHEEL_MIN_LOCK_MS = 220
/** 低于此值视为波谷，之后的新冲量可连续翻页。 */
export const WHEEL_SETTLE_DELTA = 12
/** 波谷之后，单次 |delta| 达到此值视为下一次滑动。 */
export const WHEEL_REFIRE_IMPULSE = 28
/** 完全停歇后重置手势状态。 */
export const WHEEL_GESTURE_END_MS = 140

export type WheelStepDirection = 1 | -1

export type WheelStepGestureState = {
  accum: number
  locked: boolean
  seenSettle: boolean
  lockAt: number
}

export function createWheelStepGestureState(): WheelStepGestureState {
  return {
    accum: 0,
    locked: false,
    seenSettle: false,
    lockAt: 0,
  }
}

export function resetWheelStepGestureState(state: WheelStepGestureState): void {
  state.accum = 0
  state.locked = false
  state.seenSettle = false
  state.lockAt = 0
}

/** 绝对值更大的轴；对角滑只产出一条 delta，避免横竖连切。 */
export function dominantWheelDelta(deltaX: number, deltaY: number): number {
  if (deltaX === 0 && deltaY === 0) {
    return 0
  }
  return Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY
}

/** Flip 3D：手指右/下滑与方向键同向。自然滚动的 wheel 符号要反过来。 */
export function flip3dWheelDelta(deltaX: number, deltaY: number): number {
  const delta = dominantWheelDelta(deltaX, deltaY)
  return delta === 0 ? 0 : -delta
}

/** 桌面换页只认横向；竖向或斜向偏竖交给页面自己滚。 */
export function horizontalWheelDelta(deltaX: number, deltaY: number): number {
  return Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : 0
}

function fireWheelStep(
  state: WheelStepGestureState,
  direction: WheelStepDirection,
  now: number,
): WheelStepDirection {
  state.accum = 0
  state.locked = true
  state.seenSettle = false
  state.lockAt = now
  return direction
}

/** 把一次 wheel delta 喂给步进状态机；过阈值 / 波谷再冲量时返回方向。 */
export function applyWheelStepDelta(
  state: WheelStepGestureState,
  delta: number,
  now: number,
): WheelStepDirection | undefined {
  const absDelta = Math.abs(delta)

  if (state.locked) {
    if (now - state.lockAt < WHEEL_MIN_LOCK_MS) {
      return undefined
    }
    if (absDelta <= WHEEL_SETTLE_DELTA) {
      state.seenSettle = true
      return undefined
    }
    if (state.seenSettle && absDelta >= WHEEL_REFIRE_IMPULSE) {
      return fireWheelStep(state, delta > 0 ? 1 : -1, now)
    }
    return undefined
  }

  if (
    state.accum !== 0 &&
    Math.sign(delta) !== 0 &&
    Math.sign(delta) !== Math.sign(state.accum)
  ) {
    state.accum = 0
  }

  state.accum += delta
  if (Math.abs(state.accum) < WHEEL_PAGE_THRESHOLD) {
    return undefined
  }

  return fireWheelStep(state, state.accum > 0 ? 1 : -1, now)
}

export function useWheelStepGesture(
  enabled: boolean,
  getDelta: (event: WheelEvent) => number,
  onStep: (direction: WheelStepDirection) => void,
): void {
  const getDeltaRef = useRef(getDelta)
  const onStepRef = useRef(onStep)
  getDeltaRef.current = getDelta
  onStepRef.current = onStep

  useEffect(() => {
    if (!enabled) {
      return
    }

    const state = createWheelStepGestureState()
    let idleTimer: number | undefined
    let stepTimer: number | undefined

    const clearIdle = () => {
      if (idleTimer === undefined) {
        return
      }
      window.clearTimeout(idleTimer)
      idleTimer = undefined
    }

    const clearStep = () => {
      if (stepTimer === undefined) {
        return
      }
      window.clearTimeout(stepTimer)
      stepTimer = undefined
    }

    const armIdle = () => {
      clearIdle()
      idleTimer = window.setTimeout(() => {
        resetWheelStepGestureState(state)
        idleTimer = undefined
      }, WHEEL_GESTURE_END_MS)
    }

    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey) {
        return
      }
      const delta = getDeltaRef.current(event)
      if (delta === 0) {
        return
      }

      // 挡住触控板横向后退/前进，以及 Flip 3D 叠层里网页自己滚动。
      event.preventDefault()
      armIdle()
      const direction = applyWheelStepDelta(state, delta, performance.now())
      if (direction === undefined) {
        return
      }
      // 切窗/换页不要写在 wheel 回调里：手势期间 CSS transition 常被拖到松手才播，假窗飞出就和方向键对不上。
      const step = direction
      clearStep()
      stepTimer = window.setTimeout(() => {
        stepTimer = undefined
        onStepRef.current(step)
      }, 0)
    }

    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      clearIdle()
      clearStep()
    }
  }, [enabled])
}
