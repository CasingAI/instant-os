import { createQuickJsInstance } from './quickjs-instance.ts'
import { runQuickJsSandbox } from './quickjs-sandbox.ts'

async function testSandbox() {
  const add = await runQuickJsSandbox('1 + 2 * 3')
  if (!add.ok || add.value !== 7) {
    throw new Error(`unexpected add result: ${JSON.stringify(add)}`)
  }

  const withGlobals = await runQuickJsSandbox('NAME + "!"', {
    globals: { NAME: 'QuickJS' },
  })
  if (!withGlobals.ok || withGlobals.value !== 'QuickJS!') {
    throw new Error(`unexpected globals result: ${JSON.stringify(withGlobals)}`)
  }

  const failure = await runQuickJsSandbox('throw new Error("boom")')
  if (failure.ok || !failure.error.includes('boom')) {
    throw new Error(`unexpected failure result: ${JSON.stringify(failure)}`)
  }

  console.log('quickjs-sandbox smoke test passed')
}

async function testInstance() {
  const instance = await createQuickJsInstance()

  const first = await instance.eval('var __alive = 41; __alive')
  if (!first.ok || first.value !== 41) {
    throw new Error(`unexpected first eval: ${JSON.stringify(first)}`)
  }

  const second = await instance.eval('__alive = __alive + 1; __alive')
  if (!second.ok || second.value !== 42) {
    throw new Error(`unexpected second eval (globals should persist): ${JSON.stringify(second)}`)
  }

  const logged = await instance.eval('console.log("hello", 1); "ok"')
  if (!logged.ok || logged.value !== 'ok') {
    throw new Error(`unexpected console eval: ${JSON.stringify(logged)}`)
  }
  if (!logged.consoleLines.some((line) => line.level === 'log' && line.text.includes('hello'))) {
    throw new Error(`expected console line, got: ${JSON.stringify(logged.consoleLines)}`)
  }

  const snapshot = instance.getSnapshot()
  if (snapshot.destroyed || snapshot.busy) {
    throw new Error(`unexpected snapshot before destroy: ${JSON.stringify(snapshot)}`)
  }

  instance.destroy()

  if (!instance.getSnapshot().destroyed) {
    throw new Error('expected destroyed snapshot after destroy')
  }

  let threw = false
  try {
    await instance.eval('1')
  } catch {
    threw = true
  }
  if (!threw) {
    throw new Error('expected eval after destroy to throw')
  }

  console.log('quickjs-instance smoke test passed')
}

async function main() {
  await testSandbox()
  await testInstance()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
