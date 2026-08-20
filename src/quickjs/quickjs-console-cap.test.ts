/**
 * QuickJS console 环形缓冲上限单测（无 DOM）。
 */
import assert from 'node:assert/strict'
import {
  createQuickJsInstance,
  QUICKJS_MAX_CONSOLE_LINE_CHARS,
  QUICKJS_MAX_CONSOLE_LINES,
} from './quickjs-public.ts'

const instance = await createQuickJsInstance({
  workspaceRoot: '/user',
  cwd: '/user',
  fsMode: 'readonly',
})

try {
  const oversize = 'x'.repeat(QUICKJS_MAX_CONSOLE_LINE_CHARS + 50)
  await instance.eval(`console.log(${JSON.stringify(oversize)})`)
  const afterClip = instance.getSnapshot().consoleLines
  const last = afterClip[afterClip.length - 1]
  assert.ok(last)
  assert.equal(last.text.length, QUICKJS_MAX_CONSOLE_LINE_CHARS + 1) // + '…'
  assert.ok(last.text.endsWith('…'))

  const flood = QUICKJS_MAX_CONSOLE_LINES + 100
  await instance.eval(`
    for (let i = 0; i < ${flood}; i++) console.log('line-' + i);
  `)
  const lines = instance.getSnapshot().consoleLines
  assert.equal(lines.length, QUICKJS_MAX_CONSOLE_LINES)
  assert.ok(lines[0]?.text.startsWith('line-'))
  assert.equal(lines[lines.length - 1]?.text, `line-${flood - 1}`)

  console.log('quickjs-console-cap.test.ts: ok')
} finally {
  instance.destroy()
}
