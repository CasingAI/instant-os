/**
 * program 作用域隔离：同实例两次 const fs 不 redeclaration；user 顶层仍会撞。
 * 另覆盖 async wrap 的 await / waitUntilIdle 定时器。
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

function consoleText(result: { consoleLines: { text: string }[] }): string {
  return result.consoleLines.map((line) => line.text).join('\n')
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

async function testProgramAwaitAndReturn(): Promise<void> {
  await resetRoot()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'normal',
    timeoutMs: 10_000,
  })
  const snippet = `
const v = await Promise.resolve(42)
console.log('got', v)
return v
`
  const result = await instance.eval(wrapTerminalProgramEval(snippet))
  instance.destroy()
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  assert.equal(result.ok ? result.value : undefined, 42)
  assert.ok(consoleText(result).includes('got 42'), consoleText(result))
  console.log('ok: program wrap supports await + return')
}

async function testWaitUntilIdleDrainsTimeout(): Promise<void> {
  await resetRoot()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'normal',
    timeoutMs: 10_000,
  })
  const snippet = `
console.log('before')
setTimeout(function () { console.log('after') }, 40)
`
  const result = await instance.eval(wrapTerminalProgramEval(snippet), {
    waitUntilIdle: true,
    timeoutMs: 10_000,
  })
  instance.destroy()
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  const text = consoleText(result)
  assert.ok(text.includes('before'), text)
  assert.ok(text.includes('after'), text)
  console.log('ok: waitUntilIdle drains setTimeout before return')
}

async function testWithoutWaitUntilIdleSkipsTimeout(): Promise<void> {
  await resetRoot()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'normal',
    timeoutMs: 10_000,
  })
  const snippet = `
console.log('sync')
setTimeout(function () { console.log('later') }, 80)
`
  const result = await instance.eval(wrapTerminalProgramEval(snippet), {
    waitUntilIdle: false,
  })
  const text = consoleText(result)
  instance.destroy()
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  assert.ok(text.includes('sync'), text)
  assert.ok(!text.includes('later'), `should not wait for timer: ${text}`)
  console.log('ok: default eval does not wait for setTimeout')
}

async function main(): Promise<void> {
  await testProgramAllowsRedeclareConst()
  await testBareEvalStillRedeclares()
  await testProgramAwaitAndReturn()
  await testWaitUntilIdleDrainsTimeout()
  await testWithoutWaitUntilIdleSkipsTimeout()
  console.log('all program-eval smoke tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
