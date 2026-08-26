/**
 * 运行：node --experimental-strip-types src/apps/files/files-op-window-position.test.ts
 */
import assert from 'node:assert/strict'
import {
  defaultFilesOpWindowPosition,
  FILES_OP_WINDOW_WIDTH,
  FILES_OP_WINDOW_HEIGHT,
} from './files-op-window-position.ts'

{
  const pos = defaultFilesOpWindowPosition({ width: 1280, height: 800 }, {
    width: FILES_OP_WINDOW_WIDTH,
    height: FILES_OP_WINDOW_HEIGHT,
  })
  assert.equal(pos.x, (1280 - FILES_OP_WINDOW_WIDTH) / 2)
  assert.equal(pos.y, Math.round(800 * 0.18))
}

{
  // 视口比面板还小：坐标仍保持非负，且不低于可点击底线
  const pos = defaultFilesOpWindowPosition({ width: 300, height: 200 }, {
    width: FILES_OP_WINDOW_WIDTH,
    height: FILES_OP_WINDOW_HEIGHT,
  })
  assert.ok(pos.x >= 8)
  assert.ok(pos.y >= 48)
}

{
  // 很矮的视口：y 抬高到底线，不跟顶部状态栏重叠
  const pos = defaultFilesOpWindowPosition({ width: 1280, height: 120 }, {
    width: FILES_OP_WINDOW_WIDTH,
    height: FILES_OP_WINDOW_HEIGHT,
  })
  assert.equal(pos.y, 48)
}

console.log('files-op-window-position.test.ts: ok')