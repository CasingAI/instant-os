/**
 * 生成应用单窗口强制单测。
 * 运行：node --experimental-strip-types src/os/single-window.test.ts
 */
import assert from 'node:assert/strict'
import { resolveSingleWindowForApp } from './single-window.ts'
import type { WindowState } from './types.ts'

function makeWindow(id: string, appId: string, partial: Partial<WindowState> = {}): WindowState {
  return {
    id,
    appId: appId as WindowState['appId'],
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

function testExistingVisibleWindowIsReused(): void {
  const windows = [
    makeWindow('gen:a-1', 'gen:a', { zIndex: 1 }),
    makeWindow('gen:b-1', 'gen:b', { zIndex: 2 }),
  ]
  const target = resolveSingleWindowForApp(windows, 'gen:a')
  assert.equal(target?.id, 'gen:a-1', '已打开窗口应被复用')
}

function testMinimizedWindowIsReusedOverNewWindow(): void {
  const windows = [makeWindow('gen:a-1', 'gen:a', { minimized: true })]
  const target = resolveSingleWindowForApp(windows, 'gen:a')
  assert.equal(target?.id, 'gen:a-1', '最小化窗口应被恢复而非新建')
}

function testClosingWindowsAreExcluded(): void {
  const windows = [
    makeWindow('gen:a-1', 'gen:a', { closing: true }),
    makeWindow('gen:a-2', 'gen:a', { minimized: true }),
  ]
  const target = resolveSingleWindowForApp(windows, 'gen:a')
  assert.equal(target?.id, 'gen:a-2', 'closing 中的窗口不算活窗口')
}

function testNoWindowReturnsUndefined(): void {
  const windows = [makeWindow('gen:b-1', 'gen:b')]
  assert.equal(resolveSingleWindowForApp(windows, 'gen:a'), undefined)
}

function testOtherAppsNotAffected(): void {
  const windows = [makeWindow('weather-1', 'weather')]
  assert.equal(resolveSingleWindowForApp(windows, 'gen:a'), undefined)
  assert.equal(resolveSingleWindowForApp(windows, 'weather')?.id, 'weather-1')
}

async function main(): Promise<void> {
  const cases = [
    testExistingVisibleWindowIsReused,
    testMinimizedWindowIsReusedOverNewWindow,
    testClosingWindowsAreExcluded,
    testNoWindowReturnsUndefined,
    testOtherAppsNotAffected,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('single-window: all passed')
}

await main()
