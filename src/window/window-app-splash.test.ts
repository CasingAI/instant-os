/**
 * 窗口启动层揭开时机。
 * 运行：node --experimental-strip-types src/window/window-app-splash.test.ts
 */
import assert from 'node:assert/strict'
import {
  canRevealWindowSplash,
  remainingWindowSplashMs,
  windowSplashIconSize,
  WINDOW_SPLASH_ICON_MAX_PX,
  WINDOW_SPLASH_ICON_MIN_PX,
  WINDOW_SPLASH_MIN_MS,
} from './window-app-splash.ts'

const shownAt = 1_000

assert.equal(
  remainingWindowSplashMs({
    shownAt,
    now: shownAt + 50,
    contentReady: false,
  }),
  undefined,
  '内容未就绪时即使过了很久也不揭开',
)

assert.equal(
  remainingWindowSplashMs({
    shownAt,
    now: shownAt + 10_000,
    contentReady: false,
  }),
  undefined,
  '内容未就绪：超时也不揭开',
)

assert.equal(
  remainingWindowSplashMs({
    shownAt,
    now: shownAt,
    contentReady: true,
  }),
  WINDOW_SPLASH_MIN_MS,
  '内容瞬间就绪：仍须等满最短时间',
)

assert.equal(
  remainingWindowSplashMs({
    shownAt,
    now: shownAt + 399,
    contentReady: true,
  }),
  1,
  '差 1ms 未满 400ms 不揭开',
)

assert.equal(
  remainingWindowSplashMs({
    shownAt,
    now: shownAt + WINDOW_SPLASH_MIN_MS,
    contentReady: true,
  }),
  0,
  '满 400ms 且就绪：立刻揭开',
)

assert.equal(
  remainingWindowSplashMs({
    shownAt,
    now: shownAt + 800,
    contentReady: true,
  }),
  0,
  '超过最短时间且就绪：不再等待',
)

assert.equal(
  canRevealWindowSplash({
    shownAt,
    now: shownAt + 200,
    contentReady: true,
  }),
  false,
)

assert.equal(
  canRevealWindowSplash({
    shownAt,
    now: shownAt + WINDOW_SPLASH_MIN_MS,
    contentReady: true,
  }),
  true,
)

assert.equal(
  canRevealWindowSplash({
    shownAt,
    now: shownAt + WINDOW_SPLASH_MIN_MS,
    contentReady: false,
  }),
  false,
  '满 400ms 但内容未就绪：不揭开',
)

assert.equal(
  remainingWindowSplashMs({
    shownAt,
    now: shownAt + 100,
    contentReady: true,
    minMs: 400,
  }),
  300,
)

assert.equal(windowSplashIconSize(400, 300), WINDOW_SPLASH_ICON_MIN_PX, '小窗不低于 2 倍')
assert.equal(windowSplashIconSize(720, 520), 130, '常见窗口约 2 倍略放大')
assert.equal(windowSplashIconSize(1024, 768), 192)
assert.equal(windowSplashIconSize(1920, 1080), WINDOW_SPLASH_ICON_MAX_PX, '大窗封顶 4 倍')
assert.equal(windowSplashIconSize(2560, 1440), WINDOW_SPLASH_ICON_MAX_PX)

console.log('window-app-splash: reveal timing ok')
