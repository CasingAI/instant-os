/**
 * 程序坞占用高度跟设置档位，自动压缩只缩小板块。
 * 运行：node --experimental-strip-types src/dock/dock-layout-metrics.test.ts
 */
import assert from 'node:assert/strict'
import {
  resolveEffectiveDockScale,
  type DockLayoutSnapshot,
} from './dock-fit-scale.ts'
import {
  DOCK_BASE_RESERVE_PX,
  DOCK_SIZE_TIER_SCALES,
  resolveDockReservePx,
  resolveDockSizeScale,
  type DockSettings,
} from './dock-settings-storage.ts'

function settings(sizeTier: DockSettings['sizeTier']): DockSettings {
  return {
    sizeTier,
    desktopClickAction: 'reveal',
    desktopHoldAction: 'flip3d',
  }
}

const fewItems: DockLayoutSnapshot = { pinnedCount: 4, runningUnpinnedCount: 0 }
const manyItems: DockLayoutSnapshot = { pinnedCount: 24, runningUnpinnedCount: 8 }
const wideViewport = 1920

{
  const large = settings('large')
  const fewScale = resolveEffectiveDockScale(large, wideViewport, fewItems)
  const manyScale = resolveEffectiveDockScale(large, wideViewport, manyItems)
  const fewReserve = resolveDockReservePx(resolveDockSizeScale(large))
  const manyReserve = resolveDockReservePx(resolveDockSizeScale(large))

  assert.equal(fewScale, DOCK_SIZE_TIER_SCALES.large)
  assert.ok(manyScale < fewScale, '图标变多时应自动缩小板块')
  assert.equal(fewReserve, manyReserve, '占用高度不随图标数量变化')
  assert.equal(fewReserve, DOCK_BASE_RESERVE_PX)
}

{
  const largeReserve = resolveDockReservePx(resolveDockSizeScale(settings('large')))
  const extraLargeReserve = resolveDockReservePx(resolveDockSizeScale(settings('extraLarge')))
  const miniReserve = resolveDockReservePx(resolveDockSizeScale(settings('mini')))

  assert.equal(largeReserve, Math.round(DOCK_BASE_RESERVE_PX * DOCK_SIZE_TIER_SCALES.large))
  assert.equal(
    extraLargeReserve,
    Math.round(DOCK_BASE_RESERVE_PX * DOCK_SIZE_TIER_SCALES.extraLarge),
  )
  assert.equal(miniReserve, Math.round(DOCK_BASE_RESERVE_PX * DOCK_SIZE_TIER_SCALES.mini))
  assert.ok(extraLargeReserve > largeReserve)
  assert.ok(miniReserve < largeReserve)
}

console.log('dock-layout-metrics.test.ts ok')
