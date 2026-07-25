/**
 * program 作用域隔离：同实例两次 const fs 不 redeclaration；user 顶层仍会撞。
 * 运行：node --experimental-strip-types src/apps/terminal/terminal-repl-program-eval.smoke-test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesMkdir, filesRemove, filesStat } from '../files/files-api.ts'
import { createQuickJsInstance } from '../../quickjs/quickjs-instance.ts'
import { wrapTerminalProgramEval } from './terminal-repl-program-eval.ts'

const ROOT = '/user/tprog-smoke'

async function resetRoot(): Promise<void> {
  const existing = await filesStat(ROOT)
  if (existing !== undefined) {
    await filesRemove(ROOT)
  }
  await filesMkdir(ROOT)
}

async function testProgramAllowsRedeclareConst(): Promise<void> {
  await resetRoot()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'normal',
    timeoutMs: 10_000,
  })
  const snippet = `const fs = require('fs'); console.log(typeof fs)`
  const first = await instance.eval(wrapTerminalProgramEval(snippet))
  const second = await instance.eval(wrapTerminalProgramEval(snippet))
  instance.destroy()
  assert.equal(first.ok, true, first.ok ? '' : first.error)
  assert.equal(second.ok, true, second.ok ? '' : second.error)
  assert.ok(
    !String(second.ok ? '' : second.error).includes('redeclaration'),
    `unexpected error: ${second.ok ? '' : second.error}`,
  )
  console.log('ok: program wrap allows repeated const fs')
}

async function testBareEvalStillRedeclares(): Promise<void> {
  await resetRoot()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'normal',
    timeoutMs: 10_000,
  })
  const snippet = `const x = 1`
  const first = await instance.eval(snippet)
  const second = await instance.eval(snippet)
  instance.destroy()
  assert.equal(first.ok, true, first.ok ? '' : first.error)
  assert.equal(second.ok, false)
  assert.ok(
    String(second.error).toLowerCase().includes('redeclaration') ||
      String(second.error).includes('already been declared') ||
      String(second.error).includes('x'),
    `expected redeclaration, got: ${second.error}`,
  )
  console.log('ok: bare eval still redeclares const (REPL semantics)')
}

async function main(): Promise<void> {
  await testProgramAllowsRedeclareConst()
  await testBareEvalStillRedeclares()
  console.log('all program-eval smoke tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
