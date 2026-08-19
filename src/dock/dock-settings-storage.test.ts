/**
 * 程序坞和桌面设置：点击/按住空白处动作与旧数据兼容。
 * 运行：node --experimental-strip-types src/dock/dock-settings-storage.test.ts
 */
import assert from 'node:assert/strict'
import {
  desktopClickActionLabel,
  normalizeDockSettings,
  resolveDesktopClickAction,
  resolveDesktopHoldAction,
} from './dock-settings-storage.ts'

{
  const settings = normalizeDockSettings({ sizeTier: 'small' })
  assert.equal(settings.sizeTier, 'small')
  assert.equal(settings.desktopClickAction, 'reveal')
  assert.equal(settings.desktopHoldAction, 'flip3d')
}

{
  const settings = normalizeDockSettings({
    sizeTier: 'large',
    desktopClickAction: 'flip3d',
    desktopHoldAction: 'flip3d',
  })
  assert.equal(settings.desktopClickAction, 'flip3d')
  assert.equal(settings.desktopHoldAction, 'flip3d')
  assert.equal(resolveDesktopClickAction(settings), 'flip3d')
  assert.equal(resolveDesktopHoldAction(settings), 'flip3d')
}

{
  const settings = normalizeDockSettings({
    sizeTier: 'medium',
    desktopClickAction: 'nope',
    desktopHoldAction: 'nope',
  })
  assert.equal(settings.desktopClickAction, 'reveal')
  assert.equal(settings.desktopHoldAction, 'flip3d')
}

{
  const settings = normalizeDockSettings({
    sizeTier: 'large',
    desktopClickAction: 'flip3d',
  })
  assert.equal(settings.desktopClickAction, 'flip3d')
  assert.equal(settings.desktopHoldAction, 'flip3d')
}

{
  const settings = normalizeDockSettings({ sizeScale: 1 })
  assert.equal(settings.sizeTier, 'large')
  assert.equal(settings.desktopClickAction, 'reveal')
  assert.equal(settings.desktopHoldAction, 'flip3d')
}

assert.equal(desktopClickActionLabel('reveal'), '散开窗口')
assert.equal(desktopClickActionLabel('flip3d'), '切换窗口')

console.log('dock-settings-storage.test.ts ok')
