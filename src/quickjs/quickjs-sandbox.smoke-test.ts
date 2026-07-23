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

  const host = instance.getHostConfig()
  if (host.workspaceRoot !== undefined) {
    throw new Error(`expected no workspaceRoot by default, got ${host.workspaceRoot}`)
  }
  if (host.argv[0] !== 'instant-node') {
    throw new Error(`unexpected default argv: ${JSON.stringify(host.argv)}`)
  }
  if (host.env.HOME !== '/user' || host.env.USER !== 'user') {
    throw new Error(`unexpected default env: ${JSON.stringify(host.env)}`)
  }
  if (host.permissions.network !== false) {
    throw new Error('expected network permission false')
  }
  if (host.permissions.fsReadRoots.length !== 0 || host.permissions.fsWriteRoots.length !== 0) {
    throw new Error(`expected empty fs roots without workspace, got ${JSON.stringify(host.permissions)}`)
  }

  const withRoot = await createQuickJsInstance({
    workspaceRoot: '/user/project',
    env: { FOO: 'bar' },
    argv: ['instant-node', '/user/project/main.js'],
  })
  const rooted = withRoot.getHostConfig()
  if (rooted.workspaceRoot !== '/user/project') {
    throw new Error(`unexpected workspaceRoot: ${rooted.workspaceRoot}`)
  }
  if (rooted.env.FOO !== 'bar' || rooted.env.HOME !== undefined) {
    throw new Error(`env should be whole-table replace when passed: ${JSON.stringify(rooted.env)}`)
  }
  if (
    rooted.permissions.fsReadRoots.length !== 1 ||
    rooted.permissions.fsReadRoots[0] !== '/user/project'
  ) {
    throw new Error(`unexpected fs roots: ${JSON.stringify(rooted.permissions)}`)
  }
  withRoot.destroy()

  let invalidRootThrew = false
  try {
    await createQuickJsInstance({ workspaceRoot: 'relative/path' })
  } catch {
    invalidRootThrew = true
  }
  if (!invalidRootThrew) {
    throw new Error('expected invalid workspaceRoot to throw')
  }

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
  if (logged.exited || logged.exitCode !== 0) {
    throw new Error(`unexpected exit fields on console eval: ${JSON.stringify(logged)}`)
  }

  const snapBeforeProcess = instance.getSnapshot()
  if (snapBeforeProcess.cwd !== '/user' || snapBeforeProcess.exitCode !== 0) {
    throw new Error(`unexpected default process snapshot: ${JSON.stringify(snapBeforeProcess)}`)
  }

  const processBasics = await instance.eval(`
    process.stdout.write("out:" + process.env.HOME);
    process.stderr.write("err");
    process.chdir("/user/docs");
    process.cwd()
  `)
  if (!processBasics.ok || processBasics.value !== '/user/docs') {
    throw new Error(`unexpected process basics: ${JSON.stringify(processBasics)}`)
  }
  if (!processBasics.consoleLines.some((line) => line.level === 'log' && line.text.includes('out:/user'))) {
    throw new Error(`expected stdout line, got: ${JSON.stringify(processBasics.consoleLines)}`)
  }
  if (!processBasics.consoleLines.some((line) => line.level === 'error' && line.text === 'err')) {
    throw new Error(`expected stderr line, got: ${JSON.stringify(processBasics.consoleLines)}`)
  }
  if (instance.getSnapshot().cwd !== '/user/docs') {
    throw new Error(`cwd should persist after chdir: ${JSON.stringify(instance.getSnapshot())}`)
  }

  const exitCodeOnly = await instance.eval('process.exitCode = 7; "done"')
  if (!exitCodeOnly.ok || exitCodeOnly.exited || exitCodeOnly.exitCode !== 7) {
    throw new Error(`unexpected exitCode-only result: ${JSON.stringify(exitCodeOnly)}`)
  }

  const exited = await instance.eval('process.stdout.write("before-exit"); process.exit(2); process.stdout.write("after-exit")')
  if (!exited.ok || !exited.exited || exited.exitCode !== 2) {
    throw new Error(`unexpected process.exit result: ${JSON.stringify(exited)}`)
  }
  if (exited.consoleLines.some((line) => line.text.includes('after-exit'))) {
    throw new Error(`code after process.exit should not run: ${JSON.stringify(exited.consoleLines)}`)
  }
  if (instance.getSnapshot().destroyed) {
    throw new Error('process.exit must not destroy the instance')
  }

  const afterExit = await instance.eval('process.cwd()')
  if (!afterExit.ok || afterExit.value !== '/user/docs' || afterExit.exited) {
    throw new Error(`instance should remain usable after exit: ${JSON.stringify(afterExit)}`)
  }
  if (afterExit.exitCode !== 2) {
    throw new Error(`exitCode should persist across evals: ${JSON.stringify(afterExit)}`)
  }

  const rootedCwd = await createQuickJsInstance({ workspaceRoot: '/user/project' })
  const cwdFromRoot = await rootedCwd.eval('process.cwd()')
  if (!cwdFromRoot.ok || cwdFromRoot.value !== '/user/project') {
    throw new Error(`expected cwd from workspaceRoot: ${JSON.stringify(cwdFromRoot)}`)
  }
  rootedCwd.destroy()

  const pathRequire = await instance.eval(`
    const __path = require('path');
    __path.join('/user', 'docs', 'a.txt')
  `)
  if (!pathRequire.ok || pathRequire.value !== '/user/docs/a.txt') {
    throw new Error(`unexpected require('path') join: ${JSON.stringify(pathRequire)}`)
  }

  const pathNodePrefix = await instance.eval(`
    require('node:path').resolve('rel')
  `)
  if (!pathNodePrefix.ok || pathNodePrefix.value !== '/user/docs/rel') {
    throw new Error(`unexpected require('node:path') resolve: ${JSON.stringify(pathNodePrefix)}`)
  }

  const pathImport = await instance.eval(`
    import path from 'path';
    export default path.dirname('/user/docs/a.txt');
  `)
  if (!pathImport.ok) {
    throw new Error(`unexpected import path failure: ${JSON.stringify(pathImport)}`)
  }
  const pathImportDefault =
    pathImport.value &&
    typeof pathImport.value === 'object' &&
    'default' in pathImport.value
      ? (pathImport.value as { default: unknown }).default
      : pathImport.value
  if (pathImportDefault !== '/user/docs') {
    throw new Error(`unexpected import path default export: ${JSON.stringify(pathImport)}`)
  }

  const pathImportStar = await instance.eval(`
    import * as pathMod from 'node:path';
    export default pathMod.extname('file.tar.gz');
  `)
  if (!pathImportStar.ok) {
    throw new Error(`unexpected import * path failure: ${JSON.stringify(pathImportStar)}`)
  }
  const pathImportStarDefault =
    pathImportStar.value &&
    typeof pathImportStar.value === 'object' &&
    'default' in pathImportStar.value
      ? (pathImportStar.value as { default: unknown }).default
      : pathImportStar.value
  if (pathImportStarDefault !== '.gz') {
    throw new Error(`unexpected import * path: ${JSON.stringify(pathImportStar)}`)
  }

  await instance.eval('process.chdir("/user")')
  const resolveAfterChdir = await instance.eval(`
    require('path').resolve('x')
  `)
  if (!resolveAfterChdir.ok || resolveAfterChdir.value !== '/user/x') {
    throw new Error(`resolve should follow chdir: ${JSON.stringify(resolveAfterChdir)}`)
  }

  const missingBuiltin = await instance.eval(`require('fs')`)
  if (
    missingBuiltin.ok ||
    !missingBuiltin.error.includes('not implemented yet') ||
    !missingBuiltin.error.includes("'fs'")
  ) {
    throw new Error(`expected unimplemented builtin error: ${JSON.stringify(missingBuiltin)}`)
  }

  const missingThirdParty = await instance.eval(`require('lodash')`)
  if (
    missingThirdParty.ok ||
    !missingThirdParty.error.includes('only supports implemented Node builtins')
  ) {
    throw new Error(`expected third-party require error: ${JSON.stringify(missingThirdParty)}`)
  }

  const snapshot = instance.getSnapshot()
  if (snapshot.destroyed || snapshot.busy) {
    throw new Error(`unexpected snapshot before destroy: ${JSON.stringify(snapshot)}`)
  }

  // --- L1.2 timers / microtasks / async bridge ---
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  const timerInstance = await createQuickJsInstance()
  const microOrder = await timerInstance.eval(`
    var __order = []
    queueMicrotask(function () { __order.push('micro') })
    setTimeout(function () { __order.push('timeout'); console.log('order:' + __order.join(',')) }, 30)
    __order.push('sync')
    __order.slice()
  `)
  // 最后表达式在 drain 之前求值，故返回值只有 sync；微任务在返回前排空
  if (!microOrder.ok || JSON.stringify(microOrder.value) !== JSON.stringify(['sync'])) {
    throw new Error(
      `expected sync-only return value before drain snapshot, got: ${JSON.stringify(microOrder)}`,
    )
  }
  const orderAfterDrain = await timerInstance.eval('__order.slice()')
  if (!orderAfterDrain.ok || JSON.stringify(orderAfterDrain.value) !== JSON.stringify(['sync', 'micro'])) {
    throw new Error(
      `expected micro drained before first eval returned: ${JSON.stringify(orderAfterDrain)}`,
    )
  }
  if (microOrder.consoleLines.some((line) => line.text.includes('order:'))) {
    throw new Error('timeout should not have fired before eval returned')
  }

  const duringTimer = await timerInstance.eval('"while-timer-pending"')
  if (!duringTimer.ok || duringTimer.value !== 'while-timer-pending') {
    throw new Error(`eval while timer pending should work: ${JSON.stringify(duringTimer)}`)
  }

  await sleep(80)
  const afterTimerSnap = timerInstance.getSnapshot()
  if (!afterTimerSnap.consoleLines.some((line) => line.text === 'order:sync,micro,timeout')) {
    throw new Error(
      `expected timeout console after wait: ${JSON.stringify(afterTimerSnap.consoleLines)}`,
    )
  }

  const cleared = await timerInstance.eval(`
    var __cleared = false
    var id = setTimeout(function () { __cleared = true; console.log('should-not-fire') }, 20)
    clearTimeout(id)
    'cleared'
  `)
  if (!cleared.ok || cleared.value !== 'cleared') {
    throw new Error(`clearTimeout eval failed: ${JSON.stringify(cleared)}`)
  }
  await sleep(50)
  if (timerInstance.getSnapshot().consoleLines.some((line) => line.text === 'should-not-fire')) {
    throw new Error('clearTimeout should prevent callback')
  }

  await timerInstance.eval(`
    var __ticks = 0
    var __iid = setInterval(function () {
      __ticks += 1
      console.log('tick-' + __ticks)
      if (__ticks >= 3) {
        clearInterval(__iid)
        console.log('cleared-from-callback')
      }
    }, 25)
  `)
  await sleep(200)
  const intervalSnap = timerInstance.getSnapshot()
  const tickLines = intervalSnap.consoleLines.filter((line) => line.text.startsWith('tick-'))
  if (tickLines.length !== 3) {
    throw new Error(`expected 3 ticks then self-clear, got: ${JSON.stringify(tickLines)}`)
  }
  if (!intervalSnap.consoleLines.some((line) => line.text === 'cleared-from-callback')) {
    throw new Error('expected clearInterval from inside callback to succeed')
  }
  await sleep(80)
  const tickLinesAfter = timerInstance
    .getSnapshot()
    .consoleLines.filter((line) => line.text.startsWith('tick-'))
  if (tickLinesAfter.length !== 3) {
    throw new Error(`interval should stay cleared, got: ${JSON.stringify(tickLinesAfter)}`)
  }

  const promiseJob = await timerInstance.eval(`
    var __p = false
    Promise.resolve().then(function () { __p = true; console.log('promise-job') })
    'scheduled'
  `)
  if (!promiseJob.ok || promiseJob.value !== 'scheduled') {
    throw new Error(`promise job eval failed: ${JSON.stringify(promiseJob)}`)
  }
  if (!promiseJob.consoleLines.some((line) => line.text === 'promise-job')) {
    throw new Error(
      `executePendingJobs should run promise then before eval returns: ${JSON.stringify(promiseJob.consoleLines)}`,
    )
  }

  await timerInstance.eval(`
    setTimeout(function () { console.log('after-destroy-should-not') }, 20)
  `)
  timerInstance.destroy()
  await sleep(50)
  // destroyed instance snapshot still readable
  if (!timerInstance.getSnapshot().destroyed) {
    throw new Error('expected timerInstance destroyed')
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
