import 'fake-indexeddb/auto'
import { filesCreateText, filesMkdir, filesRemove, filesStat, filesSymlink } from '../apps/files/files-api.ts'
import {
  extractNodePathFromBinShim,
  isDeprecatedNpmTscPlaceholderSource,
  looksLikeShellBinShim,
  npmScriptGuestPermissions,
} from '../packages/package-run.ts'
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
  if (host.permissions.fsWriteDenyRoots.length !== 0) {
    throw new Error(`expected empty fsWriteDenyRoots without workspace`)
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
    rooted.permissions.fsReadRoots[0] !== '/'
  ) {
    throw new Error(`unexpected fs read roots: ${JSON.stringify(rooted.permissions)}`)
  }
  if (
    rooted.permissions.fsWriteRoots.length < 1 ||
    rooted.permissions.fsWriteRoots[0] !== '/user/project'
  ) {
    throw new Error(`unexpected fs write roots: ${JSON.stringify(rooted.permissions)}`)
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

  const processProbe = await instance.eval(`
    ;({
      version: process.version,
      node: process.versions && process.versions.node,
      v8: process.versions && process.versions.v8,
      electronUndefined: process.versions.electron === undefined,
      platform: process.platform,
      arch: process.arch,
      stdoutNotTTY: process.stdout.isTTY === false,
      isElectronApp: !!process.versions.electron,
    })
  `)
  if (!processProbe.ok) {
    throw new Error(`process CLI probe failed: ${JSON.stringify(processProbe)}`)
  }
  const probe = processProbe.value as Record<string, unknown>
  if (
    typeof probe.version !== 'string' ||
    !String(probe.version).startsWith('v') ||
    typeof probe.node !== 'string' ||
    typeof probe.v8 !== 'string' ||
    probe.electronUndefined !== true ||
    probe.platform !== 'linux' ||
    probe.arch !== 'x64' ||
    probe.stdoutNotTTY !== true ||
    probe.isElectronApp !== false
  ) {
    throw new Error(`unexpected process CLI probe: ${JSON.stringify(probe)}`)
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

  const missingBuiltin = await instance.eval(`require('http')`)
  if (
    missingBuiltin.ok ||
    !missingBuiltin.error.includes('not implemented yet') ||
    !missingBuiltin.error.includes("'http'")
  ) {
    throw new Error(`expected unimplemented builtin error: ${JSON.stringify(missingBuiltin)}`)
  }

  const missingThirdParty = await instance.eval(`require('lodash')`)
  if (
    missingThirdParty.ok ||
    !missingThirdParty.error.includes('node_modules')
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

  // --- L1.16 process.nextTick（与 Promise 同相，先于定时器）---
  const nextTickBasics = await timerInstance.eval(`
    var __nt = []
    process.nextTick(function (a, b) {
      __nt.push('tick:' + a + ':' + b)
    }, 'x', 1)
    __nt.push('sync')
    __nt.slice()
  `)
  if (!nextTickBasics.ok || JSON.stringify(nextTickBasics.value) !== JSON.stringify(['sync'])) {
    throw new Error(
      `nextTick return should be sync-only before drain: ${JSON.stringify(nextTickBasics)}`,
    )
  }
  const nextTickAfter = await timerInstance.eval('__nt.slice()')
  if (
    !nextTickAfter.ok ||
    JSON.stringify(nextTickAfter.value) !== JSON.stringify(['sync', 'tick:x:1'])
  ) {
    throw new Error(
      `nextTick should drain before eval returns: ${JSON.stringify(nextTickAfter)}`,
    )
  }

  const nextTickBeforeTimeout = await timerInstance.eval(`
    var __phase = []
    process.nextTick(function () { __phase.push('nextTick') })
    Promise.resolve().then(function () { __phase.push('promise') })
    queueMicrotask(function () { __phase.push('micro') })
    setTimeout(function () {
      __phase.push('timeout')
      console.log('phase:' + __phase.join(','))
    }, 20)
    __phase.push('sync')
    'scheduled'
  `)
  if (!nextTickBeforeTimeout.ok) {
    throw new Error(`nextTick phase eval failed: ${JSON.stringify(nextTickBeforeTimeout)}`)
  }
  const phaseAfterDrain = await timerInstance.eval('__phase.slice()')
  if (!phaseAfterDrain.ok || !Array.isArray(phaseAfterDrain.value)) {
    throw new Error(`phase after drain failed: ${JSON.stringify(phaseAfterDrain)}`)
  }
  const phaseList = phaseAfterDrain.value as string[]
  if (phaseList[0] !== 'sync') {
    throw new Error(`expected sync first: ${JSON.stringify(phaseList)}`)
  }
  if (phaseList.includes('timeout')) {
    throw new Error(`timeout must not run in drain: ${JSON.stringify(phaseList)}`)
  }
  for (const name of ['nextTick', 'promise', 'micro'] as const) {
    if (!phaseList.includes(name)) {
      throw new Error(`expected ${name} in micro-phase: ${JSON.stringify(phaseList)}`)
    }
  }
  await sleep(60)
  const phaseSnap = timerInstance.getSnapshot()
  const phaseLine = phaseSnap.consoleLines.find((line) => line.text.startsWith('phase:'))
  if (phaseLine === undefined || !phaseLine.text.endsWith(',timeout')) {
    throw new Error(
      `expected timeout last in phase console: ${JSON.stringify(phaseSnap.consoleLines)}`,
    )
  }

  const nextTickAbort = await createQuickJsInstance()
  await nextTickAbort.eval(`
    setTimeout(function () { console.log('aborted-timeout-ran') }, 30)
    'armed'
  `)
  nextTickAbort.abort()
  await sleep(80)
  const abortSnap = nextTickAbort.getSnapshot()
  if (abortSnap.consoleLines.some((line) => line.text === 'aborted-timeout-ran')) {
    throw new Error('abort should clear pending timers')
  }
  // abort 清队列后，新一轮 nextTick 仍应可用（cleared 标志在再次入队时复位）
  const afterAbortTick = await nextTickAbort.eval(`
    var __afterAbort = false
    process.nextTick(function () { __afterAbort = true })
    'queued'
  `)
  if (!afterAbortTick.ok) {
    throw new Error(`nextTick after abort failed: ${JSON.stringify(afterAbortTick)}`)
  }
  const afterAbortFlag = await nextTickAbort.eval('__afterAbort')
  if (!afterAbortFlag.ok || afterAbortFlag.value !== true) {
    throw new Error(
      `nextTick should work again after abort: ${JSON.stringify(afterAbortFlag)}`,
    )
  }
  nextTickAbort.destroy()

  const nextTickDepth = await timerInstance.eval(`
    var __depth = 0
    function boom() {
      __depth += 1
      process.nextTick(boom)
    }
    process.nextTick(boom)
    'started'
  `)
  if (!nextTickDepth.ok) {
    throw new Error(`nextTick depth eval failed: ${JSON.stringify(nextTickDepth)}`)
  }
  const depthSnap = timerInstance.getSnapshot()
  if (
    !depthSnap.consoleLines.some(
      (line) => line.level === 'error' && line.text.includes('nextTick drain limit'),
    )
  ) {
    throw new Error(
      `expected nextTick drain limit error: ${JSON.stringify(depthSnap.consoleLines)}`,
    )
  }
  const depthAfter = await timerInstance.eval('__depth')
  if (!depthAfter.ok || typeof depthAfter.value !== 'number' || depthAfter.value < 1000) {
    throw new Error(`expected substantial nextTick depth before limit: ${JSON.stringify(depthAfter)}`)
  }

  const bufferBasics = await timerInstance.eval(`
    var fromGlobal = Buffer.from('hi')
    var viaRequire = require('buffer').Buffer
    var same = Buffer === viaRequire
    var hex = fromGlobal.toString('hex')
    var b64 = Buffer.from([104, 105]).toString('base64')
    var back = Buffer.from(hex, 'hex').toString('utf8')
    var isU8 = fromGlobal instanceof Uint8Array
    var isBuf = Buffer.isBuffer(fromGlobal)
    ;({ same: same, hex: hex, b64: b64, back: back, isU8: isU8, isBuf: isBuf })
  `)
  if (!bufferBasics.ok) {
    throw new Error(`Buffer basics failed: ${JSON.stringify(bufferBasics)}`)
  }
  const bufVal = bufferBasics.value as Record<string, unknown>
  if (
    bufVal.same !== true ||
    bufVal.hex !== '6869' ||
    bufVal.b64 !== 'aGk=' ||
    bufVal.back !== 'hi' ||
    bufVal.isU8 !== true ||
    bufVal.isBuf !== true
  ) {
    throw new Error(`unexpected Buffer basics: ${JSON.stringify(bufVal)}`)
  }

  const bufferImport = await timerInstance.eval(`
import { Buffer as BufNamed } from 'node:buffer'
import bufMod from 'buffer'
export default {
  sameNamed: BufNamed === Buffer,
  sameDefault: bufMod.Buffer === Buffer,
  kMax: typeof bufMod.kMaxLength === 'number',
}
`)
  if (!bufferImport.ok) {
    throw new Error(`buffer import failed: ${JSON.stringify(bufferImport)}`)
  }
  const importVal = (bufferImport.value as { default?: Record<string, unknown> }).default ??
    (bufferImport.value as Record<string, unknown>)
  if (importVal.sameNamed !== true || importVal.sameDefault !== true || importVal.kMax !== true) {
    throw new Error(`unexpected buffer import: ${JSON.stringify(bufferImport.value)}`)
  }

  const textEnc = await timerInstance.eval(`
    var enc = new TextEncoder()
    var bytes = enc.encode('你好')
    var dec = new TextDecoder()
    var text = dec.decode(bytes)
    var bad = null
    try { new TextDecoder('gbk') } catch (e) { bad = String(e && e.message ? e.message : e) }
    ;({
      encoding: enc.encoding,
      text: text,
      byteLength: bytes.byteLength,
      badOk: typeof bad === 'string' && bad.indexOf('utf-8') !== -1
    })
  `)
  if (!textEnc.ok) {
    throw new Error(`TextEncoder/Decoder failed: ${JSON.stringify(textEnc)}`)
  }
  const teVal = textEnc.value as Record<string, unknown>
  if (
    teVal.encoding !== 'utf-8' ||
    teVal.text !== '你好' ||
    teVal.byteLength !== 6 ||
    teVal.badOk !== true
  ) {
    throw new Error(`unexpected TextEncoder result: ${JSON.stringify(teVal)}`)
  }

  const stdoutBuf = await timerInstance.eval(`
    process.stdout.write(Buffer.from('stdout-buf-ok'))
    'done'
  `)
  if (!stdoutBuf.ok || stdoutBuf.value !== 'done') {
    throw new Error(`stdout Buffer write failed: ${JSON.stringify(stdoutBuf)}`)
  }
  if (!stdoutBuf.consoleLines.some((line) => line.text === 'stdout-buf-ok')) {
    throw new Error(
      `expected stdout Buffer decoded in console: ${JSON.stringify(stdoutBuf.consoleLines)}`,
    )
  }

  // --- L1.6 fs / fs.promises / Sync (Asyncify) ---
  const fsRoot = '/user/qjs-fs-smoke'
  const existing = await filesStat(fsRoot)
  if (existing !== undefined) {
    await filesRemove(fsRoot)
  }
  await filesMkdir(fsRoot)

  const fsInstance = await createQuickJsInstance({
    workspaceRoot: fsRoot,
    timeoutMs: 15_000,
  })

  const fsAsyncOk = await fsInstance.eval(`
    var __fsAsyncDone = false
    var __fsAsyncResult = null
    var __fsAsyncError = null
    ;(async function () {
      try {
        var fs = require('fs/promises')
        await fs.writeFile('hello.txt', 'hello-async')
        var text = await fs.readFile('hello.txt', 'utf8')
        await fs.appendFile('hello.txt', '-more')
        var text2 = await fs.readFile('hello.txt', 'utf8')
        await fs.mkdir('sub', { recursive: true })
        await fs.writeFile('sub/a.txt', 'a')
        var names = await fs.readdir('.')
        var st = await fs.stat('hello.txt')
        await fs.rename('sub/a.txt', 'sub/b.txt')
        var exists = true
        try { await fs.access('sub/b.txt') } catch (e) { exists = false }
        await fs.unlink('sub/b.txt')
        await fs.rm('sub', { recursive: true, force: true })
        __fsAsyncResult = {
          text: text,
          text2: text2,
          namesOk: names.indexOf('hello.txt') !== -1,
          isFile: st.isFile(),
          size: st.size,
          exists: exists
        }
      } catch (e) {
        __fsAsyncError = String(e && e.message ? e.message : e)
      } finally {
        __fsAsyncDone = true
      }
    })()
    'started'
  `)
  if (!fsAsyncOk.ok) {
    throw new Error(`fs async start failed: ${JSON.stringify(fsAsyncOk)}`)
  }
  for (let i = 0; i < 50; i++) {
    await sleep(20)
    const done = await fsInstance.eval('__fsAsyncDone')
    if (done.ok && done.value === true) break
  }
  const fsAsyncResult = await fsInstance.eval(
    '__fsAsyncError ? { error: __fsAsyncError } : __fsAsyncResult',
  )
  if (!fsAsyncResult.ok) {
    throw new Error(`fs async result failed: ${JSON.stringify(fsAsyncResult)}`)
  }
  const far = fsAsyncResult.value as Record<string, unknown>
  if (far.error) {
    throw new Error(`fs async error: ${far.error}`)
  }
  if (
    far.text !== 'hello-async' ||
    far.text2 !== 'hello-async-more' ||
    far.namesOk !== true ||
    far.isFile !== true ||
    far.exists !== true
  ) {
    throw new Error(`unexpected fs async result: ${JSON.stringify(far)}`)
  }

  const fsSync = await fsInstance.eval(`
    var fs = require('fs')
    fs.writeFileSync('sync.txt', 'sync-ok')
    var t = fs.readFileSync('sync.txt', 'utf8')
    var st = fs.statSync('sync.txt')
    ;({ t: t, isFile: st.isFile(), size: st.size })
  `)
  if (!fsSync.ok) {
    throw new Error(`fs sync failed: ${JSON.stringify(fsSync)}`)
  }
  const fsv = fsSync.value as Record<string, unknown>
  if (fsv.t !== 'sync-ok' || fsv.isFile !== true) {
    throw new Error(`unexpected fs sync result: ${JSON.stringify(fsv)}`)
  }

  const fsImport = await fsInstance.eval(`
    import fs from 'node:fs'
    import fsp from 'node:fs/promises'
    export default {
      hasSync: typeof fs.readFileSync === 'function',
      hasPromises: typeof fsp.writeFile === 'function',
      samePromises: fs.promises === fsp,
    }
  `)
  if (!fsImport.ok) {
    throw new Error(`fs import failed: ${JSON.stringify(fsImport)}`)
  }
  const fsImportVal =
    fsImport.value && typeof fsImport.value === 'object' && 'default' in fsImport.value
      ? (fsImport.value as { default: Record<string, unknown> }).default
      : (fsImport.value as Record<string, unknown>)
  if (
    fsImportVal.hasSync !== true ||
    fsImportVal.hasPromises !== true ||
    fsImportVal.samePromises !== true
  ) {
    throw new Error(`unexpected fs import: ${JSON.stringify(fsImport)}`)
  }

  const denied = await createQuickJsInstance({ timeoutMs: 5000 })
  const deniedResult = await denied.eval(`
    try {
      require('fs').readFileSync('/user/qjs-fs-smoke/sync.txt', 'utf8')
      'ok'
    } catch (e) {
      String(e && e.code ? e.code : e)
    }
  `)
  denied.destroy()
  if (!deniedResult.ok || deniedResult.value !== 'EACCES') {
    throw new Error(`expected EACCES without workspace: ${JSON.stringify(deniedResult)}`)
  }

  const tiny = await createQuickJsInstance({
    workspaceRoot: fsRoot,
    maxFileBytes: 8,
    timeoutMs: 5000,
  })
  const tooLarge = await tiny.eval(`
    try {
      require('fs').writeFileSync('big.txt', '0123456789')
      'ok'
    } catch (e) {
      String(e && e.code ? e.code : e)
    }
  `)
  tiny.destroy()
  if (!tooLarge.ok || tooLarge.value !== 'ERR_FS_FILE_TOO_LARGE') {
    throw new Error(`expected file too large: ${JSON.stringify(tooLarge)}`)
  }

  // destroy 后不可再 eval
  const hang = await createQuickJsInstance({ workspaceRoot: fsRoot, timeoutMs: 5_000 })
  hang.destroy()
  let hangThrew = false
  try {
    await hang.eval(`require('fs').readFileSync('sync.txt', 'utf8')`)
  } catch {
    hangThrew = true
  }
  if (!hangThrew) {
    throw new Error('expected eval after destroy to throw')
  }

  fsInstance.destroy()
  try {
    await filesRemove(fsRoot)
  } catch {
    // best-effort cleanup
  }

  // --- L1.8 ESM multi-file modules ---
  const esmRoot = '/user/qjs-esm-smoke'
  try {
    await filesRemove(esmRoot)
  } catch {
    // ok if missing
  }
  await filesMkdir(esmRoot)
  const esmInstance = await createQuickJsInstance({ workspaceRoot: esmRoot })
  const writeMods = await esmInstance.eval(`
    var fs = require('fs')
    fs.writeFileSync('lib.js', [
      'export const answer = 42',
      'export default function greeter(n) { return "hi-" + n }',
      '',
    ].join('\\n'))
    fs.writeFileSync('counter.js', [
      'globalThis.__esmLoadCount = (globalThis.__esmLoadCount || 0) + 1',
      'export const loads = globalThis.__esmLoadCount',
      '',
    ].join('\\n'))
    'written'
  `)
  if (!writeMods.ok || writeMods.value !== 'written') {
    throw new Error(`esm write setup failed: ${JSON.stringify(writeMods)}`)
  }

  const relativeImport = await esmInstance.eval(`
    import greeter, { answer } from './lib.js'
    globalThis.__esmRel = greeter(answer)
  `)
  if (!relativeImport.ok) {
    throw new Error(`relative ESM import failed: ${JSON.stringify(relativeImport)}`)
  }
  const relativeValue = await esmInstance.eval('globalThis.__esmRel')
  if (!relativeValue.ok || relativeValue.value !== 'hi-42') {
    throw new Error(`relative ESM import value: ${JSON.stringify(relativeValue)}`)
  }

  const absoluteImport = await esmInstance.eval(`
    import { answer } from '${esmRoot}/lib.js'
    globalThis.__esmAbs = answer
  `)
  if (!absoluteImport.ok) {
    throw new Error(`absolute ESM import failed: ${JSON.stringify(absoluteImport)}`)
  }
  const absoluteValue = await esmInstance.eval('globalThis.__esmAbs')
  if (!absoluteValue.ok || absoluteValue.value !== 42) {
    throw new Error(`absolute ESM import value: ${JSON.stringify(absoluteValue)}`)
  }

  const cached = await esmInstance.eval(`
    import { loads as a } from './counter.js'
    import { loads as b } from './counter.js'
    globalThis.__esmCache = [a, b, globalThis.__esmLoadCount]
  `)
  if (!cached.ok) {
    throw new Error(`cache ESM import failed: ${JSON.stringify(cached)}`)
  }
  const cachedValue = await esmInstance.eval('globalThis.__esmCache')
  if (!cachedValue.ok || JSON.stringify(cachedValue.value) !== JSON.stringify([1, 1, 1])) {
    throw new Error(`expected instance module cache: ${JSON.stringify(cachedValue)}`)
  }

  const cachedAgain = await esmInstance.eval(`
    import { loads } from './counter.js'
    globalThis.__esmCache2 = loads
  `)
  if (!cachedAgain.ok) {
    throw new Error(`second cache import failed: ${JSON.stringify(cachedAgain)}`)
  }
  const cachedAgainValue = await esmInstance.eval('globalThis.__esmCache2')
  if (!cachedAgainValue.ok || cachedAgainValue.value !== 1) {
    throw new Error(`module cache should survive later eval: ${JSON.stringify(cachedAgainValue)}`)
  }

  const missingExt = await esmInstance.eval(`
    import './lib'
  `)
  if (
    missingExt.ok ||
    !missingExt.error.includes('explicit file extension') ||
    !missingExt.error.includes('./lib')
  ) {
    throw new Error(`expected missing extension error: ${JSON.stringify(missingExt)}`)
  }

  const bareImport = await esmInstance.eval(`
    import 'lodash'
  `)
  if (bareImport.ok || !bareImport.error.includes('node_modules')) {
    throw new Error(`expected bare import node_modules error: ${JSON.stringify(bareImport)}`)
  }

  // ESM 文件用 export 语法；CJS require 应在求值期失败（非「仅内建」推迟）
  const requireEsmSyntax = await esmInstance.eval(`
    require('./lib.js')
  `)
  if (requireEsmSyntax.ok) {
    throw new Error(`expected require of ESM-syntax file to fail: ${JSON.stringify(requireEsmSyntax)}`)
  }

  const deniedEsm = await createQuickJsInstance({
    workspaceRoot: esmRoot,
    permissions: { fsReadRoots: [], fsWriteRoots: [esmRoot] },
  })
  const deniedImport = await deniedEsm.eval(`
    import { answer } from './lib.js'
    globalThis.__denied = answer
  `)
  if (deniedImport.ok || !deniedImport.error.toLowerCase().includes('permission')) {
    throw new Error(`expected ESM read permission denial: ${JSON.stringify(deniedImport)}`)
  }
  deniedEsm.destroy()

  const namedEntry = await esmInstance.eval(
    `
    import greeter from '../lib.js'
    globalThis.__namedEntry = greeter(1)
  `,
    { filename: `${esmRoot}/apps/entry.js` },
  )
  if (!namedEntry.ok) {
    throw new Error(`filename option eval failed: ${JSON.stringify(namedEntry)}`)
  }
  const namedEntryValue = await esmInstance.eval('globalThis.__namedEntry')
  if (!namedEntryValue.ok || namedEntryValue.value !== 'hi-1') {
    throw new Error(
      `filename option should resolve relative to entry dir: ${JSON.stringify(namedEntryValue)}`,
    )
  }

  esmInstance.destroy()
  try {
    await filesRemove(esmRoot)
  } catch {
    // best-effort cleanup
  }

  // --- L1.9 CJS require (extension probe, parent path, cache, json, cycles) ---
  const cjsRoot = '/user/qjs-cjs-smoke'
  try {
    await filesRemove(cjsRoot)
  } catch {
    // ok if missing
  }
  await filesMkdir(cjsRoot)
  const cjsInstance = await createQuickJsInstance({ workspaceRoot: cjsRoot })
  const cjsSetup = await cjsInstance.eval(`
    var fs = require('fs')
    fs.mkdirSync('lib', { recursive: true })
    fs.mkdirSync('pkg', { recursive: true })
    fs.writeFileSync('lib/b.js', 'module.exports = { where: "lib-b", n: 7 }\\n')
    fs.writeFileSync(
      'lib/a.js',
      [
        'var b = require("./b")',
        'module.exports = { from: "lib-a", b: b.where, n: b.n }',
        '',
      ].join('\\n'),
    )
    fs.writeFileSync('top.js', 'module.exports = { top: true }\\n')
    fs.writeFileSync('data.json', JSON.stringify({ hello: 'cjs-json' }))
    fs.writeFileSync('pkg/index.js', 'module.exports = { index: true }\\n')
    fs.writeFileSync(
      'cycle-a.js',
      [
        'exports.name = "a"',
        'exports.other = require("./cycle-b").name',
        '',
      ].join('\\n'),
    )
    fs.writeFileSync(
      'cycle-b.js',
      [
        'exports.name = "b"',
        'exports.other = require("./cycle-a").name',
        '',
      ].join('\\n'),
    )
    fs.writeFileSync(
      'counter-cjs.js',
      [
        'globalThis.__cjsLoadCount = (globalThis.__cjsLoadCount || 0) + 1',
        'module.exports = { loads: globalThis.__cjsLoadCount }',
        '',
      ].join('\\n'),
    )
    'cjs-written'
  `)
  if (!cjsSetup.ok || cjsSetup.value !== 'cjs-written') {
    throw new Error(`cjs setup failed: ${JSON.stringify(cjsSetup)}`)
  }

  const parentPath = await cjsInstance.eval(`
    var a = require('./lib/a')
    globalThis.__cjsParent = a
  `)
  if (!parentPath.ok) {
    throw new Error(`parent-path require failed: ${JSON.stringify(parentPath)}`)
  }
  const parentValue = await cjsInstance.eval('globalThis.__cjsParent')
  if (
    !parentValue.ok ||
    JSON.stringify(parentValue.value) !== JSON.stringify({ from: 'lib-a', b: 'lib-b', n: 7 })
  ) {
    throw new Error(`parent-path require value: ${JSON.stringify(parentValue)}`)
  }

  const probeExt = await cjsInstance.eval(`
    var top = require('./top')
    globalThis.__cjsProbe = top.top
  `)
  if (!probeExt.ok) {
    throw new Error(`extension probe failed: ${JSON.stringify(probeExt)}`)
  }
  const probeValue = await cjsInstance.eval('globalThis.__cjsProbe')
  if (!probeValue.ok || probeValue.value !== true) {
    throw new Error(`extension probe value: ${JSON.stringify(probeValue)}`)
  }

  const indexReq = await cjsInstance.eval(`
    var pkg = require('./pkg')
    globalThis.__cjsIndex = pkg.index
  `)
  if (!indexReq.ok) {
    throw new Error(`index require failed: ${JSON.stringify(indexReq)}`)
  }
  const indexValue = await cjsInstance.eval('globalThis.__cjsIndex')
  if (!indexValue.ok || indexValue.value !== true) {
    throw new Error(`index require value: ${JSON.stringify(indexValue)}`)
  }

  const jsonReq = await cjsInstance.eval(`
    var data = require('./data')
    globalThis.__cjsJson = data.hello
  `)
  if (!jsonReq.ok) {
    throw new Error(`json require failed: ${JSON.stringify(jsonReq)}`)
  }
  const jsonValue = await cjsInstance.eval('globalThis.__cjsJson')
  if (!jsonValue.ok || jsonValue.value !== 'cjs-json') {
    throw new Error(`json require value: ${JSON.stringify(jsonValue)}`)
  }

  const cycleReq = await cjsInstance.eval(`
    var a = require('./cycle-a')
    globalThis.__cjsCycle = [a.name, a.other]
  `)
  if (!cycleReq.ok) {
    throw new Error(`cycle require failed: ${JSON.stringify(cycleReq)}`)
  }
  const cycleValue = await cjsInstance.eval('globalThis.__cjsCycle')
  if (!cycleValue.ok || JSON.stringify(cycleValue.value) !== JSON.stringify(['a', 'b'])) {
    throw new Error(`cycle require value: ${JSON.stringify(cycleValue)}`)
  }

  const cjsCache = await cjsInstance.eval(`
    var x = require('./counter-cjs')
    var y = require('./counter-cjs')
    globalThis.__cjsCache = [x.loads, y.loads, globalThis.__cjsLoadCount]
  `)
  if (!cjsCache.ok) {
    throw new Error(`cjs cache failed: ${JSON.stringify(cjsCache)}`)
  }
  const cjsCacheValue = await cjsInstance.eval('globalThis.__cjsCache')
  if (!cjsCacheValue.ok || JSON.stringify(cjsCacheValue.value) !== JSON.stringify([1, 1, 1])) {
    throw new Error(`cjs cache value: ${JSON.stringify(cjsCacheValue)}`)
  }

  const resolvePath = await cjsInstance.eval(`
    require.resolve('./lib/a.js')
  `)
  if (!resolvePath.ok || resolvePath.value !== `${cjsRoot}/lib/a.js`) {
    throw new Error(`require.resolve failed: ${JSON.stringify(resolvePath)}`)
  }

  const mjsRequire = await cjsInstance.eval(`
    var fs = require('fs')
    fs.writeFileSync('only.mjs', 'export const x = 1\\n')
    require('./only.mjs')
  `)
  if (
    mjsRequire.ok ||
    (!mjsRequire.error.includes('ERR_REQUIRE_ESM') && !mjsRequire.error.includes('ES Module'))
  ) {
    throw new Error(`expected ERR_REQUIRE_ESM for .mjs: ${JSON.stringify(mjsRequire)}`)
  }

  // 回合制回归：模块体在 require 加载期调用 fs.*Sync（不得 Already suspended）
  const syncInModuleSetup = await cjsInstance.eval(`
    var fs = require('fs')
    fs.writeFileSync('sync-in-mod-data.txt', 'payload-ok')
    fs.writeFileSync(
      'sync-in-mod.js',
      [
        "var fs = require('fs')",
        "var t = fs.readFileSync(__dirname + '/sync-in-mod-data.txt', 'utf8')",
        "module.exports = { text: t, exists: fs.existsSync(__dirname + '/sync-in-mod-data.txt') }",
        '',
      ].join('\\n'),
    )
    'sync-in-mod-written'
  `)
  if (!syncInModuleSetup.ok || syncInModuleSetup.value !== 'sync-in-mod-written') {
    throw new Error(`sync-in-module setup failed: ${JSON.stringify(syncInModuleSetup)}`)
  }
  const syncInModule = await cjsInstance.eval(`
    var m = require('./sync-in-mod.js')
    globalThis.__syncInMod = m
  `)
  if (!syncInModule.ok) {
    throw new Error(`sync-in-module require failed: ${JSON.stringify(syncInModule)}`)
  }
  const syncInModuleValue = await cjsInstance.eval('globalThis.__syncInMod')
  if (
    !syncInModuleValue.ok ||
    typeof syncInModuleValue.value !== 'object' ||
    syncInModuleValue.value === null ||
    (syncInModuleValue.value as { text?: unknown; exists?: unknown }).text !== 'payload-ok' ||
    (syncInModuleValue.value as { text?: unknown; exists?: unknown }).exists !== true
  ) {
    throw new Error(`sync-in-module value: ${JSON.stringify(syncInModuleValue)}`)
  }

  // eval({ filename }) 应对齐顶层 require 的父路径（npx 跑 bin 入口）
  const namedCjsSetup = await cjsInstance.eval(`
    var fs = require('fs')
    fs.mkdirSync('bin-entry', { recursive: true })
    fs.writeFileSync('bin-entry/lib.js', 'module.exports = { tag: "from-lib" }\\n')
    fs.writeFileSync(
      'bin-entry/cli.js',
      "var m = require('./lib')\\nglobalThis.__namedCjs = m.tag\\n",
    )
    'named-cjs-written'
  `)
  if (!namedCjsSetup.ok || namedCjsSetup.value !== 'named-cjs-written') {
    throw new Error(`named CJS setup failed: ${JSON.stringify(namedCjsSetup)}`)
  }
  const namedCjs = await cjsInstance.eval("var m = require('./lib')\nglobalThis.__namedCjs = m.tag\n", {
    filename: `${cjsRoot}/bin-entry/cli.js`,
  })
  if (!namedCjs.ok) {
    throw new Error(`named CJS eval filename require failed: ${JSON.stringify(namedCjs)}`)
  }
  const namedCjsValue = await cjsInstance.eval('globalThis.__namedCjs')
  if (!namedCjsValue.ok || namedCjsValue.value !== 'from-lib') {
    throw new Error(`named CJS require parent: ${JSON.stringify(namedCjsValue)}`)
  }

  const deniedCjs = await createQuickJsInstance({
    workspaceRoot: cjsRoot,
    permissions: { fsReadRoots: [], fsWriteRoots: [cjsRoot] },
  })
  const deniedReq = await deniedCjs.eval(`require('./top.js')`)
  if (deniedReq.ok || !deniedReq.error.toLowerCase().includes('permission')) {
    throw new Error(`expected CJS read permission denial: ${JSON.stringify(deniedReq)}`)
  }
  deniedCjs.destroy()

  // --- L1.10 package.json main / exports["."] ---
  const pkgRoot = '/user/qjs-pkg-smoke'
  try {
    await filesRemove(pkgRoot)
  } catch {
    // ok if missing
  }
  await filesMkdir(pkgRoot)
  const pkgInstance = await createQuickJsInstance({ workspaceRoot: pkgRoot })
  const pkgSetup = await pkgInstance.eval(`
    var fs = require('fs')
    fs.mkdirSync('with-main/lib', { recursive: true })
    fs.writeFileSync('with-main/lib/entry.js', 'module.exports = { via: "main" }\\n')
    fs.writeFileSync(
      'with-main/package.json',
      JSON.stringify({ name: 'with-main', main: 'lib/entry.js' }),
    )
    fs.mkdirSync('with-exports/dist', { recursive: true })
    fs.writeFileSync('with-exports/dist/index.js', 'module.exports = { via: "exports" }\\n')
    fs.writeFileSync('with-exports/old.js', 'module.exports = { via: "main-ignored" }\\n')
    fs.writeFileSync(
      'with-exports/package.json',
      JSON.stringify({
        name: 'with-exports',
        main: 'old.js',
        exports: { '.': './dist/index.js' },
      }),
    )
    fs.mkdirSync('exports-cond/lib', { recursive: true })
    fs.writeFileSync('exports-cond/lib/cjs.js', 'module.exports = { via: "require-cond" }\\n')
    fs.writeFileSync(
      'exports-cond/package.json',
      JSON.stringify({
        name: 'exports-cond',
        exports: { '.': { require: './lib/cjs.js', default: './lib/cjs.js' } },
      }),
    )
    fs.mkdirSync('exports-missing', { recursive: true })
    fs.writeFileSync(
      'exports-missing/package.json',
      JSON.stringify({ name: 'exports-missing', exports: { './other': './x.js' } }),
    )
    fs.mkdirSync('nested-req', { recursive: true })
    fs.writeFileSync(
      'nested-req/package.json',
      JSON.stringify({ name: 'nested-req', main: 'lib/entry.js' }),
    )
    fs.mkdirSync('nested-req/lib', { recursive: true })
    fs.writeFileSync('nested-req/lib/entry.js', 'module.exports = { tag: "nested-entry" }\\n')
    fs.writeFileSync(
      'nested-req/user.js',
      "module.exports = require('./')\\n",
    )
    'pkg-written'
  `)
  if (!pkgSetup.ok || pkgSetup.value !== 'pkg-written') {
    throw new Error(`pkg setup failed: ${JSON.stringify(pkgSetup)}`)
  }

  const mainReq = await pkgInstance.eval(`
    var m = require('./with-main')
    globalThis.__pkgMain = m.via
  `)
  if (!mainReq.ok) {
    throw new Error(`package main require failed: ${JSON.stringify(mainReq)}`)
  }
  const mainValue = await pkgInstance.eval('globalThis.__pkgMain')
  if (!mainValue.ok || mainValue.value !== 'main') {
    throw new Error(`package main value: ${JSON.stringify(mainValue)}`)
  }

  const exportsReq = await pkgInstance.eval(`
    var m = require('./with-exports')
    globalThis.__pkgExports = m.via
  `)
  if (!exportsReq.ok) {
    throw new Error(`package exports require failed: ${JSON.stringify(exportsReq)}`)
  }
  const exportsValue = await pkgInstance.eval('globalThis.__pkgExports')
  if (!exportsValue.ok || exportsValue.value !== 'exports') {
    throw new Error(`exports should win over main: ${JSON.stringify(exportsValue)}`)
  }

  const condReq = await pkgInstance.eval(`
    var m = require('./exports-cond')
    globalThis.__pkgCond = m.via
  `)
  if (!condReq.ok) {
    throw new Error(`exports condition require failed: ${JSON.stringify(condReq)}`)
  }
  const condValue = await pkgInstance.eval('globalThis.__pkgCond')
  if (!condValue.ok || condValue.value !== 'require-cond') {
    throw new Error(`exports condition value: ${JSON.stringify(condValue)}`)
  }

  const missingDot = await pkgInstance.eval(`require('./exports-missing')`)
  if (
    missingDot.ok ||
    (!missingDot.error.includes('ERR_PACKAGE_PATH_NOT_EXPORTED') &&
      !missingDot.error.includes('not defined by "exports"'))
  ) {
    throw new Error(`expected ERR_PACKAGE_PATH_NOT_EXPORTED: ${JSON.stringify(missingDot)}`)
  }

  const resolvePkg = await pkgInstance.eval(`require.resolve('./with-main')`)
  if (!resolvePkg.ok || resolvePkg.value !== `${pkgRoot}/with-main/lib/entry.js`) {
    throw new Error(`require.resolve package dir: ${JSON.stringify(resolvePkg)}`)
  }

  const nestedPkg = await pkgInstance.eval(`
    var m = require('./nested-req/user')
    globalThis.__pkgNested = m.tag
  `)
  if (!nestedPkg.ok) {
    throw new Error(`nested sync require via package main failed: ${JSON.stringify(nestedPkg)}`)
  }
  const nestedValue = await pkgInstance.eval('globalThis.__pkgNested')
  if (!nestedValue.ok || nestedValue.value !== 'nested-entry') {
    throw new Error(`nested package alias value: ${JSON.stringify(nestedValue)}`)
  }

  pkgInstance.destroy()
  try {
    await filesRemove(pkgRoot)
  } catch {
    // best-effort cleanup
  }

  // --- L1.11 thin events / EventEmitter ---
  const eventsBasics = await timerInstance.eval(`
    var EE = require('events')
    var sameCtor = EE === require('node:events') && EE === EE.EventEmitter
    var notGlobal = typeof globalThis.EventEmitter === 'undefined'
    var ee = new EE()
    var seen = []
    ee.on('ping', function (n) { seen.push(n) })
    ee.emit('ping', 1)
    ee.emit('ping', 2)
    var onceHit = 0
    ee.once('once', function () { onceHit++ })
    ee.emit('once')
    ee.emit('once')
    var errThrew = false
    try { ee.emit('error', new Error('boom')) } catch (e) {
      errThrew = String(e && e.message ? e.message : e).indexOf('boom') !== -1
    }
    function Sub() { EE.call(this) }
    Sub.prototype = Object.create(EE.prototype)
    Sub.prototype.constructor = Sub
    var sub = new Sub()
    var subOk = false
    sub.on('x', function (v) { subOk = v === 7 })
    sub.emit('x', 7)
    ;({
      sameCtor: sameCtor,
      notGlobal: notGlobal,
      seen: seen.join(','),
      onceHit: onceHit,
      errThrew: errThrew,
      subOk: subOk,
      count: ee.listenerCount('ping'),
    })
  `)
  if (!eventsBasics.ok) {
    throw new Error(`events basics failed: ${JSON.stringify(eventsBasics)}`)
  }
  const evVal = eventsBasics.value as Record<string, unknown>
  if (
    evVal.sameCtor !== true ||
    evVal.notGlobal !== true ||
    evVal.seen !== '1,2' ||
    evVal.onceHit !== 1 ||
    evVal.errThrew !== true ||
    evVal.subOk !== true ||
    evVal.count !== 1
  ) {
    throw new Error(`unexpected events basics: ${JSON.stringify(evVal)}`)
  }

  const eventsImport = await timerInstance.eval(`
import EENamed from 'events'
import { EventEmitter as EENamed2 } from 'node:events'
export default {
  sameDefault: EENamed === EENamed.EventEmitter,
  sameNamed: EENamed2 === EENamed,
  works: (function () {
    var e = new EENamed()
    var n = 0
    e.on('t', function () { n++ })
    e.emit('t')
    return n === 1
  })(),
}
`)
  if (!eventsImport.ok) {
    throw new Error(`events import failed: ${JSON.stringify(eventsImport)}`)
  }
  const evImportVal =
    (eventsImport.value as { default?: Record<string, unknown> }).default ??
    (eventsImport.value as Record<string, unknown>)
  if (
    evImportVal.sameDefault !== true ||
    evImportVal.sameNamed !== true ||
    evImportVal.works !== true
  ) {
    throw new Error(`unexpected events import: ${JSON.stringify(eventsImport.value)}`)
  }

  // --- L2.5.1 / L2.5.3 thin assert + util ---
  const assertBasics = await timerInstance.eval(`
    var assert = require('assert')
    var same = assert === require('node:assert') && assert.strict === assert
    assert.ok(true)
    assert.equal(1, '1')
    assert.strictEqual(1, 1)
    assert.notStrictEqual(1, '1')
    assert.deepEqual({ a: 1 }, { a: 1 })
    assert.deepStrictEqual({ a: 1 }, { a: 1 })
    var threw = false
    try { assert.strictEqual(1, 2) } catch (e) {
      threw = e instanceof assert.AssertionError && e.code === 'ERR_ASSERTION'
    }
    var util = require('util')
    var sameUtil = util === require('node:util')
    var inspected = util.inspect({ x: 1, y: [2] })
    function Base() {}
    function Child() { Base.call(this) }
    util.inherits(Child, Base)
    var child = new Child()
    ;({
      same: same,
      threw: threw,
      sameUtil: sameUtil,
      inspectedHasX: inspected.indexOf('x') !== -1,
      inheritsOk: child instanceof Base,
      typesDate: util.types.isDate(new Date()),
    })
  `)
  if (!assertBasics.ok) {
    throw new Error(`assert/util basics failed: ${JSON.stringify(assertBasics)}`)
  }
  const assertVal = assertBasics.value as Record<string, unknown>
  if (
    assertVal.same !== true ||
    assertVal.threw !== true ||
    assertVal.sameUtil !== true ||
    assertVal.inspectedHasX !== true ||
    assertVal.inheritsOk !== true ||
    assertVal.typesDate !== true
  ) {
    throw new Error(`unexpected assert/util basics: ${JSON.stringify(assertVal)}`)
  }

  const assertImport = await timerInstance.eval(`
import assertDefault, { strictEqual, notStrictEqual } from 'assert'
import { inspect as utilInspect } from 'node:util'
export default {
  callable: typeof assertDefault === 'function',
  namedOk: (function () {
    strictEqual(1, 1)
    notStrictEqual(1, 2)
    return true
  })(),
  utilInspect: typeof utilInspect === 'function' && utilInspect(3) === '3',
}
`)
  if (!assertImport.ok) {
    throw new Error(`assert/util import failed: ${JSON.stringify(assertImport)}`)
  }
  const assertImportVal =
    (assertImport.value as { default?: Record<string, unknown> }).default ??
    (assertImport.value as Record<string, unknown>)
  if (
    assertImportVal.callable !== true ||
    assertImportVal.namedOk !== true ||
    assertImportVal.utilInspect !== true
  ) {
    throw new Error(`unexpected assert/util import: ${JSON.stringify(assertImport.value)}`)
  }

  // --- L2.5.4 thin os ---
  const osBasics = await timerInstance.eval(`
    var os = require('os')
    var same = os === require('node:os')
    ;({
      same: same,
      platform: os.platform(),
      arch: os.arch(),
      eol: os.EOL === '\\n',
      tmpdir: os.tmpdir(),
      homedir: os.homedir(),
    })
  `)
  if (!osBasics.ok) {
    throw new Error(`os basics failed: ${JSON.stringify(osBasics)}`)
  }
  const osVal = osBasics.value as Record<string, unknown>
  if (
    osVal.same !== true ||
    osVal.platform !== 'linux' ||
    osVal.arch !== 'x64' ||
    osVal.eol !== true ||
    osVal.tmpdir !== '/tmp' ||
    osVal.homedir !== '/user'
  ) {
    throw new Error(`unexpected os basics: ${JSON.stringify(osVal)}`)
  }

  const osImport = await timerInstance.eval(`
import osDefault, { platform, tmpdir } from 'os'
export default {
  sameDefault: osDefault.platform === platform,
  platform: platform(),
  tmpdir: tmpdir(),
}
`)
  if (!osImport.ok) {
    throw new Error(`os import failed: ${JSON.stringify(osImport)}`)
  }
  const osImportVal =
    (osImport.value as { default?: Record<string, unknown> }).default ??
    (osImport.value as Record<string, unknown>)
  if (
    osImportVal.sameDefault !== true ||
    osImportVal.platform !== 'linux' ||
    osImportVal.tmpdir !== '/tmp'
  ) {
    throw new Error(`unexpected os import: ${JSON.stringify(osImport.value)}`)
  }

  // --- thin module (vite CLI 入口会 import 'node:module') ---
  const moduleBasics = await timerInstance.eval(`
    var mod = require('module')
    var same = mod === require('node:module')
    mod.enableCompileCache()
    mod.flushCompileCache()
    var req = mod.createRequire('/tmp/x.js')
    var pathViaCreate = req('path')
    ;({
      same: same,
      hasEnable: typeof mod.enableCompileCache === 'function',
      hasFlush: typeof mod.flushCompileCache === 'function',
      cacheDir: mod.getCompileCacheDir(),
      createRequireWorks: pathViaCreate && typeof pathViaCreate.join === 'function',
      isBuiltinPath: mod.isBuiltin('path') === true && mod.isBuiltin('node:path') === true,
      isBuiltinHttp: mod.isBuiltin('http') === false,
      builtinHasPath: Array.isArray(mod.builtinModules) && mod.builtinModules.indexOf('path') >= 0,
    })
  `)
  if (!moduleBasics.ok) {
    throw new Error(`module basics failed: ${JSON.stringify(moduleBasics)}`)
  }
  const moduleVal = moduleBasics.value as Record<string, unknown>
  if (
    moduleVal.same !== true ||
    moduleVal.hasEnable !== true ||
    moduleVal.hasFlush !== true ||
    moduleVal.cacheDir !== undefined ||
    moduleVal.createRequireWorks !== true ||
    moduleVal.isBuiltinPath !== true ||
    moduleVal.isBuiltinHttp !== true ||
    moduleVal.builtinHasPath !== true
  ) {
    throw new Error(`unexpected module basics: ${JSON.stringify(moduleVal)}`)
  }

  const moduleImport = await timerInstance.eval(`
import modDefault, { enableCompileCache, flushCompileCache } from 'node:module'
export default {
  sameDefault: modDefault.enableCompileCache === enableCompileCache,
  enableType: typeof enableCompileCache,
  flushType: typeof flushCompileCache,
}
`)
  if (!moduleImport.ok) {
    throw new Error(`module import failed: ${JSON.stringify(moduleImport)}`)
  }
  const moduleImportVal =
    (moduleImport.value as { default?: Record<string, unknown> }).default ??
    (moduleImport.value as Record<string, unknown>)
  if (
    moduleImportVal.sameDefault !== true ||
    moduleImportVal.enableType !== 'function' ||
    moduleImportVal.flushType !== 'function'
  ) {
    throw new Error(`unexpected module import: ${JSON.stringify(moduleImport.value)}`)
  }

  // --- L3.0.1 / L3.0.2 perf_hooks（宿主真实 Performance 桥）---
  const perfBasics = await timerInstance.eval(`
    var ph = require('perf_hooks')
    var same = ph === require('node:perf_hooks')
    var performance = ph.performance
    var t0 = performance.now()
    var t1 = performance.now()
    performance.clearMarks('instant-perf-smoke-a')
    performance.clearMeasures('instant-perf-smoke')
    performance.mark('instant-perf-smoke-a')
    performance.mark('instant-perf-smoke-b')
    performance.measure('instant-perf-smoke', 'instant-perf-smoke-a', 'instant-perf-smoke-b')
    var measures = performance.getEntriesByType('measure').filter(function (e) {
      return e.name === 'instant-perf-smoke'
    })
    performance.clearMarks('instant-perf-smoke-a')
    performance.clearMarks('instant-perf-smoke-b')
    performance.clearMeasures('instant-perf-smoke')
    ;({
      same: same,
      nowNumber: typeof t0 === 'number' && typeof t1 === 'number',
      nowMonotonic: t1 >= t0,
      timeOriginNumber: typeof performance.timeOrigin === 'number',
      measureHit: measures.length === 1 && typeof measures[0].duration === 'number',
    })
  `)
  if (!perfBasics.ok) {
    throw new Error(`perf_hooks basics failed: ${JSON.stringify(perfBasics)}`)
  }
  const perfVal = perfBasics.value as Record<string, unknown>
  if (
    perfVal.same !== true ||
    perfVal.nowNumber !== true ||
    perfVal.nowMonotonic !== true ||
    perfVal.timeOriginNumber !== true ||
    perfVal.measureHit !== true
  ) {
    throw new Error(`unexpected perf_hooks basics: ${JSON.stringify(perfVal)}`)
  }

  const perfImport = await timerInstance.eval(`
import phDefault, { performance as perfNamed } from 'perf_hooks'
import { performance as nodePerf } from 'node:perf_hooks'
export default {
  sameDefault: phDefault.performance === perfNamed,
  sameNode: perfNamed === nodePerf,
  nowOk: typeof perfNamed.now() === 'number',
}
`)
  if (!perfImport.ok) {
    throw new Error(`perf_hooks import failed: ${JSON.stringify(perfImport)}`)
  }
  const perfImportVal =
    (perfImport.value as { default?: Record<string, unknown> }).default ??
    (perfImport.value as Record<string, unknown>)
  if (
    perfImportVal.sameDefault !== true ||
    perfImportVal.sameNode !== true ||
    perfImportVal.nowOk !== true
  ) {
    throw new Error(`unexpected perf_hooks import: ${JSON.stringify(perfImport.value)}`)
  }

  // --- thin builtins batch: querystring / tty / console / timers / constants / url / util+os ---
  const thinBuiltins = await timerInstance.eval(`
    var qs = require('querystring')
    var tty = require('tty')
    var cons = require('console')
    var timers = require('timers')
    var constants = require('constants')
    var url = require('url')
    var util = require('util')
    var os = require('os')
    var ph = require('perf_hooks')
    var parsed = qs.parse('a=1&b=2&a=3')
    var encoded = qs.stringify({ x: 1, y: 'z' })
    var filePath = url.fileURLToPath('file:///user/docs/a.js')
    var fileUrl = url.pathToFileURL('/user/docs/a.js')
    ;({
      qsSame: qs === require('node:querystring'),
      qsParse: parsed.a && parsed.a[0] === '1' && parsed.a[1] === '3' && parsed.b === '2',
      qsStringify: encoded === 'x=1&y=z',
      ttyStdin: tty.isatty(0) === true,
      ttyStdout: tty.isatty(1) === false,
      ttyStderr: tty.isatty(2) === false,
      consoleLog: typeof cons.log === 'function',
      timersSetTimeout: typeof timers.setTimeout === 'function',
      timersPromises: typeof timers.promises.setTimeout === 'function',
      constantsFok: constants.F_OK === 0,
      urlFilePath: filePath === '/user/docs/a.js',
      urlFileHref: fileUrl && typeof fileUrl.href === 'string' && fileUrl.href.indexOf('file:') === 0,
      hasUrlCtor: typeof url.URL === 'function' || url.URL === undefined,
      utilFormat: util.format('%s %d', 'hi', 2) === 'hi 2',
      utilDeprecate: typeof util.deprecate(function () {}, 'msg') === 'function',
      osVersion: os.version() === os.release(),
      osUser: os.userInfo().homedir === os.homedir() && os.userInfo().username === 'instant',
      hasObserver: typeof ph.PerformanceObserver === 'function',
    })
  `)
  if (!thinBuiltins.ok) {
    throw new Error(`thin builtins failed: ${JSON.stringify(thinBuiltins)}`)
  }
  const thinVal = thinBuiltins.value as Record<string, unknown>
  if (
    thinVal.qsSame !== true ||
    thinVal.qsParse !== true ||
    thinVal.qsStringify !== true ||
    thinVal.ttyStdin !== true ||
    thinVal.ttyStdout !== true ||
    thinVal.ttyStderr !== true ||
    thinVal.consoleLog !== true ||
    thinVal.timersSetTimeout !== true ||
    thinVal.timersPromises !== true ||
    thinVal.constantsFok !== true ||
    thinVal.urlFilePath !== true ||
    thinVal.urlFileHref !== true ||
    thinVal.utilFormat !== true ||
    thinVal.utilDeprecate !== true ||
    thinVal.osVersion !== true ||
    thinVal.osUser !== true ||
    thinVal.hasObserver !== true
  ) {
    throw new Error(`unexpected thin builtins: ${JSON.stringify(thinVal)}`)
  }

  const thinImport = await timerInstance.eval(`
import qsDefault, { parse as qsParse } from 'querystring'
import { isatty } from 'tty'
import { setTimeout as timersTimeout } from 'timers'
import urlDefault, { fileURLToPath } from 'url'
export default {
  qsNamed: typeof qsParse === 'function' && qsDefault.parse === qsParse,
  ttyOk: isatty(1) === false,
  timersOk: typeof timersTimeout === 'function',
  urlOk: fileURLToPath('file:///tmp/x') === '/tmp/x',
  urlDefault: typeof urlDefault.format === 'function',
}
`)
  if (!thinImport.ok) {
    throw new Error(`thin builtins import failed: ${JSON.stringify(thinImport)}`)
  }
  const thinImportVal =
    (thinImport.value as { default?: Record<string, unknown> }).default ??
    (thinImport.value as Record<string, unknown>)
  if (
    thinImportVal.qsNamed !== true ||
    thinImportVal.ttyOk !== true ||
    thinImportVal.timersOk !== true ||
    thinImportVal.urlOk !== true ||
    thinImportVal.urlDefault !== true
  ) {
    throw new Error(`unexpected thin builtins import: ${JSON.stringify(thinImport.value)}`)
  }

  const streamCryptoReadline = await timerInstance.eval(`
    var crypto = require('crypto')
    var stream = require('stream')
    var sd = require('string_decoder')
    var rl = require('readline')
    var rlp = require('readline/promises')
    var bytes = crypto.randomBytes(8)
    var uuid = crypto.randomUUID()
    var r = new stream.Readable()
    var w = new stream.Writable()
    r.push('hi')
    r.push(null)
    var dec = new sd.StringDecoder('utf8')
    var iface = rl.createInterface({ input: process.stdin, output: process.stdout })
    var prl = rlp.createInterface({ input: process.stdin, output: process.stdout })
    ;({
      cryptoSame: crypto === require('node:crypto'),
      bytesLen: bytes && bytes.length === 8,
      uuidLen: typeof uuid === 'string' && uuid.length === 36,
      readable: r.readable === true,
      writable: w.writable === true,
      passThrough: typeof stream.PassThrough === 'function',
      decode: dec.write(Buffer.from('ab')) === 'ab',
      rlQuestion: typeof iface.question === 'function',
      rlpCreate: typeof rlp.createInterface === 'function',
      streamSame: stream === require('node:stream'),
    })
  `)
  if (!streamCryptoReadline.ok) {
    throw new Error(`stream/crypto/readline failed: ${JSON.stringify(streamCryptoReadline)}`)
  }
  const scrVal = streamCryptoReadline.value as Record<string, unknown>
  if (
    scrVal.cryptoSame !== true ||
    scrVal.bytesLen !== true ||
    scrVal.uuidLen !== true ||
    scrVal.readable !== true ||
    scrVal.writable !== true ||
    scrVal.passThrough !== true ||
    scrVal.decode !== true ||
    scrVal.rlQuestion !== true ||
    scrVal.rlpCreate !== true ||
    scrVal.streamSame !== true
  ) {
    throw new Error(`unexpected stream/crypto/readline: ${JSON.stringify(scrVal)}`)
  }

  const streamImport = await timerInstance.eval(`
import { Readable, PassThrough } from 'stream'
import { StringDecoder } from 'string_decoder'
import { randomBytes } from 'crypto'
import { createInterface } from 'readline'
export default {
  readable: new Readable().readable === true,
  pt: typeof PassThrough === 'function',
  dec: new StringDecoder('utf8').write(Buffer.from('x')) === 'x',
  rnd: randomBytes(4).length === 4,
  rl: typeof createInterface === 'function',
}
`)
  if (!streamImport.ok) {
    throw new Error(`stream batch import failed: ${JSON.stringify(streamImport)}`)
  }
  const streamImportVal =
    (streamImport.value as { default?: Record<string, unknown> }).default ??
    (streamImport.value as Record<string, unknown>)
  if (
    streamImportVal.readable !== true ||
    streamImportVal.pt !== true ||
    streamImportVal.dec !== true ||
    streamImportVal.rnd !== true ||
    streamImportVal.rl !== true
  ) {
    throw new Error(`unexpected stream batch import: ${JSON.stringify(streamImport.value)}`)
  }

  const zlibSmoke = await timerInstance.eval(`
    var zlib = require('zlib')
    var gz = zlib.gzipSync('hello zlib')
    var plain = zlib.gunzipSync(gz)
  var deflated = zlib.deflateSync('abc')
  var inflated = zlib.inflateSync(deflated)
  var raw = zlib.deflateRawSync('x')
  var rawInfl = zlib.inflateRawSync(raw)
    ;({
      same: zlib === require('node:zlib'),
      gzipRound: plain.toString() === 'hello zlib',
      deflateRound: inflated.toString() === 'abc',
      rawRound: rawInfl.toString() === 'x',
      constants: zlib.constants.Z_OK === 0,
      createGzip: typeof zlib.createGzip === 'function',
    })
  `)
  if (!zlibSmoke.ok) {
    throw new Error(`zlib smoke failed: ${JSON.stringify(zlibSmoke)}`)
  }
  const zlibVal = zlibSmoke.value as Record<string, unknown>
  if (
    zlibVal.same !== true ||
    zlibVal.gzipRound !== true ||
    zlibVal.deflateRound !== true ||
    zlibVal.rawRound !== true ||
    zlibVal.constants !== true ||
    zlibVal.createGzip !== true
  ) {
    throw new Error(`unexpected zlib smoke: ${JSON.stringify(zlibVal)}`)
  }

  const cryptoHashSmoke = await timerInstance.eval(`
    var crypto = require('crypto')
    var h = crypto.createHash('sha256').update('abc').digest('hex')
    var mac = crypto.createHmac('sha256', 'key').update('msg').digest('hex')
    var latin = crypto.createHash('sha256').update('abc').digest('latin1')
    var badEnc = false
    try {
      crypto.createHash('sha256').update('x').digest('bogus')
    } catch (e) {
      badEnc = true
    }
    ;({
      hashLen: h.length === 64,
      hmacLen: mac.length === 64,
      hashDiff: h !== mac,
      latinLen: typeof latin === 'string' && latin.length === 32,
      badEnc,
    })
  `)
  if (!cryptoHashSmoke.ok) {
    throw new Error(`crypto hash smoke failed: ${JSON.stringify(cryptoHashSmoke)}`)
  }
  const hashVal = cryptoHashSmoke.value as Record<string, unknown>
  if (hashVal.hashLen !== true || hashVal.hmacLen !== true || hashVal.hashDiff !== true) {
    throw new Error(`unexpected crypto hash: ${JSON.stringify(hashVal)}`)
  }
  if (hashVal.latinLen !== true || hashVal.badEnc !== true) {
    throw new Error(`unexpected crypto digest encoding: ${JSON.stringify(hashVal)}`)
  }

  const parseArgsSmoke = await timerInstance.eval(`
    var util = require('util')
    process.argv = ['instant-node', 'script.js', '--name', 'Ada', '-v', 'file.txt']
    var r = util.parseArgs({
      args: process.argv.slice(2),
      options: {
        name: { type: 'string' },
        verbose: { type: 'boolean', short: 'v' },
      },
      allowPositionals: true,
    })
    ;({
      name: r.values.name === 'Ada',
      verbose: r.values.verbose === true,
      pos: r.positionals[0] === 'file.txt',
    })
  `)
  if (!parseArgsSmoke.ok) {
    throw new Error(`parseArgs smoke failed: ${JSON.stringify(parseArgsSmoke)}`)
  }
  const paVal = parseArgsSmoke.value as Record<string, unknown>
  if (paVal.name !== true || paVal.verbose !== true || paVal.pos !== true) {
    throw new Error(`unexpected parseArgs: ${JSON.stringify(paVal)}`)
  }

  const streamBpSmoke = await timerInstance.eval(
    `(async function () {
      var stream = require('stream')
      var wrote = []
      var paused = false
      var drained = false
      var dest = new stream.Writable({
        highWaterMark: 1,
        write: function (chunk, enc, cb) {
          wrote.push(String(chunk))
          var self = this
          globalThis.setTimeout(function () { cb() }, 0)
        }
      })
      var src = new stream.Readable({
        read: function () {}
      })
      src.pipe(dest)
      var ok1 = src.push('a')
      var ok2 = src.push('b')
      src.push(null)
      await new Promise(function (resolve) {
        dest.on('finish', resolve)
        globalThis.setTimeout(resolve, 50)
      })
      return {
        wrote: wrote.join('') === 'ab' || wrote.length >= 1,
        hasPipe: typeof src.pipe === 'function',
      }
    })()`,
    { waitUntilIdle: true },
  )
  if (!streamBpSmoke.ok) {
    throw new Error(`stream backpressure smoke failed: ${JSON.stringify(streamBpSmoke)}`)
  }

  const streamFsRoot = '/user/qjs-stream-fs-smoke'
  try {
    await filesRemove(streamFsRoot)
  } catch {
    // ok
  }
  await filesMkdir(streamFsRoot)
  const streamFsInstance = await createQuickJsInstance({ workspaceRoot: streamFsRoot })
  const streamFsSmoke = await streamFsInstance.eval(
    `(async function () {
      var fs = require('fs')
      var zlib = require('zlib')
      var stream = require('stream')
      fs.writeFileSync('in.txt', 'hello-stream-fs')
      await new Promise(function (resolve, reject) {
        var rs = fs.createReadStream('in.txt', { highWaterMark: 4 })
        var ws = fs.createWriteStream('out.txt')
        rs.on('error', reject)
        ws.on('error', reject)
        ws.on('finish', resolve)
        rs.pipe(ws)
      })
      var copied = fs.readFileSync('out.txt', 'utf8')
      await new Promise(function (resolve, reject) {
        var chunks = []
        var r = new stream.Readable({ read: function () {} })
        var gz = zlib.createGzip()
        var gun = zlib.createGunzip()
        var gzFinished = false
        gz.on('finish', function () { gzFinished = true })
        gun.on('data', function (c) { chunks.push(Buffer.from(c)) })
        gun.on('end', function () {
          try {
            var plain = Buffer.concat(chunks).toString()
            resolve(plain)
          } catch (e) { reject(e) }
        })
        gun.on('error', reject)
        gz.on('error', reject)
        r.pipe(gz).pipe(gun)
        r.push('zlib-pipe-')
        r.push('ok')
        r.push(null)
      }).then(function (plain) {
        globalThis.__zlibPipePlain = plain
      })
      return {
        copied: copied === 'hello-stream-fs',
        zlibPipe: globalThis.__zlibPipePlain === 'zlib-pipe-ok',
        hasCreateRead: typeof fs.createReadStream === 'function',
      }
    })()`,
    { waitUntilIdle: true },
  )
  if (!streamFsSmoke.ok) {
    throw new Error(`stream/fs/zlib smoke failed: ${JSON.stringify(streamFsSmoke)}`)
  }
  const sfsVal = streamFsSmoke.value as Record<string, unknown>
  if (
    sfsVal.copied !== true ||
    sfsVal.zlibPipe !== true ||
    sfsVal.hasCreateRead !== true
  ) {
    throw new Error(`unexpected stream/fs/zlib smoke: ${JSON.stringify(sfsVal)}`)
  }

  const streamFsMultiChunk = await streamFsInstance.eval(
    `(async function () {
      var fs = require('fs')
      return await new Promise(function (resolve, reject) {
        var ws = fs.createWriteStream('chunks.bin')
        ws.on('error', reject)
        ws.on('finish', function () {
          try {
            resolve(fs.readFileSync('chunks.bin').length)
          } catch (e) { reject(e) }
        })
        for (var i = 0; i < 64; i++) {
          ws.write(Buffer.from('xy'))
        }
        ws.end()
      })
    })()`,
    { waitUntilIdle: true },
  )
  streamFsInstance.destroy()
  try {
    await filesRemove(streamFsRoot)
  } catch {
    // ok
  }
  if (!streamFsMultiChunk.ok || streamFsMultiChunk.value !== 128) {
    throw new Error(`unexpected multi-chunk write: ${JSON.stringify(streamFsMultiChunk)}`)
  }

  const fetchOff = await timerInstance.eval(`typeof globalThis.fetch === 'undefined'`)
  if (!fetchOff.ok || fetchOff.value !== true) {
    throw new Error(`expected fetch absent without network: ${JSON.stringify(fetchOff)}`)
  }

  const fetchInstance = await createQuickJsInstance({
    workspaceRoot: '/user/project',
    permissions: { network: true },
  })
  const fetchSmoke = await fetchInstance.eval(
    `(async function () {
      var res = await fetch('https://example.com/')
      var text = await res.text()
      return {
        hasFetch: typeof fetch === 'function',
        ok: res.ok === true,
        hasHtml: text.toLowerCase().indexOf('html') >= 0,
      }
    })()`,
    { waitUntilIdle: true },
  )
  fetchInstance.destroy()
  if (!fetchSmoke.ok) {
    throw new Error(`fetch smoke failed: ${JSON.stringify(fetchSmoke)}`)
  }
  const fetchVal = fetchSmoke.value as Record<string, unknown>
  if (fetchVal.hasFetch !== true || fetchVal.ok !== true || fetchVal.hasHtml !== true) {
    throw new Error(`unexpected fetch smoke: ${JSON.stringify(fetchVal)}`)
  }

  cjsInstance.destroy()
  try {
    await filesRemove(cjsRoot)
  } catch {
    // best-effort cleanup
  }

  // --- L2.0 symlink ---
  const linkRoot = '/user/qjs-symlink-smoke'
  try {
    await filesRemove(linkRoot)
  } catch {
    // ok
  }
  await filesMkdir(linkRoot)
  const linkInstance = await createQuickJsInstance({ workspaceRoot: linkRoot })
  const linkSetup = await linkInstance.eval(`
    var fs = require('fs')
    fs.writeFileSync('real.txt', 'via-link')
    fs.symlinkSync('real.txt', 'alias.txt')
    var linkTarget = fs.readlinkSync('alias.txt')
    var followed = fs.readFileSync('alias.txt', 'utf8')
    var lst = fs.lstatSync('alias.txt')
    var st = fs.statSync('alias.txt')
    ;({
      linkTarget: linkTarget,
      followed: followed,
      lIsLink: lst.isSymbolicLink(),
      lIsFile: lst.isFile(),
      sIsFile: st.isFile(),
      sIsLink: st.isSymbolicLink(),
    })
  `)
  if (!linkSetup.ok) {
    throw new Error(`symlink setup failed: ${JSON.stringify(linkSetup)}`)
  }
  const linkVal = linkSetup.value as Record<string, unknown>
  if (
    linkVal.linkTarget !== 'real.txt' ||
    linkVal.followed !== 'via-link' ||
    linkVal.lIsLink !== true ||
    linkVal.lIsFile !== false ||
    linkVal.sIsFile !== true ||
    linkVal.sIsLink !== false
  ) {
    throw new Error(`unexpected symlink semantics: ${JSON.stringify(linkSetup.value)}`)
  }

  const realpathProbe = await linkInstance.eval(`
    var fs = require('fs')
    var rp = fs.realpathSync('alias.txt')
    var viaNative = fs.realpathSync.native('alias.txt')
    var viaPromise
    fs.promises.realpath('alias.txt').then(function (p) { viaPromise = p })
    ;({
      rp: rp,
      viaNative: viaNative,
      hasNativeFn: typeof fs.realpathSync.native === 'function',
      constantsFok: fs.constants.F_OK === 0,
      copyOk: (function () {
        fs.copyFileSync('real.txt', 'copy.txt')
        return fs.readFileSync('copy.txt', 'utf8')
      })(),
      mkdtempPath: fs.mkdtempSync('tmpdirXXXXXX'),
      truncated: (function () {
        fs.writeFileSync('trunc.txt', 'abcdef')
        fs.truncateSync('trunc.txt', 3)
        return fs.readFileSync('trunc.txt', 'utf8')
      })(),
      chmodOk: (function () {
        fs.chmodSync('real.txt', 0o644)
        fs.chownSync('real.txt', 0, 0)
        return true
      })(),
      dirent: (function () {
        var list = fs.readdirSync('.', { withFileTypes: true })
        var ent = list.filter(function (d) { return d.name === 'real.txt' })[0]
        return ent ? { name: ent.name, isFile: ent.isFile() } : null
      })(),
    })
  `)
  if (!realpathProbe.ok) {
    throw new Error(`fs extended probe failed: ${JSON.stringify(realpathProbe)}`)
  }
  const rpVal = realpathProbe.value as Record<string, unknown>
  const expectedReal = `${linkRoot}/real.txt`
  if (
    rpVal.rp !== expectedReal ||
    rpVal.viaNative !== expectedReal ||
    rpVal.hasNativeFn !== true ||
    rpVal.constantsFok !== true ||
    rpVal.copyOk !== 'via-link' ||
    typeof rpVal.mkdtempPath !== 'string' ||
    !(rpVal.mkdtempPath as string).includes('tmpdir') ||
    rpVal.truncated !== 'abc' ||
    rpVal.chmodOk !== true ||
    (rpVal.dirent as { isFile?: boolean } | null)?.isFile !== true
  ) {
    throw new Error(`unexpected fs extended probe: ${JSON.stringify(realpathProbe.value)}`)
  }

  const watchProbe = await linkInstance.eval(`
    var fs = require('fs')
    var events = []
    var w = fs.watch('.', function (ev, file) {
      events.push(ev + ':' + file)
    })
    fs.writeFileSync('watched.txt', '1')
    var closed = false
    w.close()
    closed = true
    ;({ count: events.length, hasClose: typeof w.close === 'function', closed: closed })
  `)
  if (!watchProbe.ok) {
    throw new Error(`fs watch probe failed: ${JSON.stringify(watchProbe)}`)
  }
  const watchVal = watchProbe.value as { count?: number; hasClose?: boolean }
  if (watchVal.hasClose !== true) {
    throw new Error(`unexpected fs watch probe: ${JSON.stringify(watchProbe.value)}`)
  }

  linkInstance.destroy()
  try {
    await filesRemove(linkRoot)
  } catch {
    // best-effort
  }

  // --- npm guest: 可读 store、禁写 node_modules（权限形态与 npmScriptGuestPermissions 一致）---
  const npmAclProject = '/user/qjs-npm-guest-acl'
  const npmAclFakeStoreRoot = '/user/qjs-npm-guest-acl-store'
  const npmAclPkgStore = `${npmAclFakeStoreRoot}/pkg/1.0.0`
  try {
    await filesRemove(npmAclProject)
  } catch {
    // ok
  }
  try {
    await filesRemove(npmAclFakeStoreRoot)
  } catch {
    // ok
  }
  await filesMkdir(npmAclFakeStoreRoot)
  await filesMkdir(`${npmAclFakeStoreRoot}/pkg`)
  await filesMkdir(npmAclPkgStore)
  await filesCreateText(`${npmAclPkgStore}/package.json`, '{"name":"acl-smoke"}')
  await filesCreateText(`${npmAclPkgStore}/entry.js`, 'module.exports = 1')
  await filesMkdir(npmAclProject)
  await filesCreateText(`${npmAclProject}/src.js`, '// app')
  await filesMkdir(`${npmAclProject}/node_modules`)
  await filesSymlink(npmAclPkgStore, `${npmAclProject}/node_modules/acl-smoke`)

  const npmAclPerms = npmScriptGuestPermissions(npmAclProject)
  npmAclPerms.fsReadRoots = [npmAclProject, npmAclFakeStoreRoot]

  const npmAclInstance = await createQuickJsInstance({
    workspaceRoot: npmAclProject,
    permissions: npmAclPerms,
  })
  const readStore = await npmAclInstance.eval(`
    var fs = require('fs')
  fs.readFileSync('${npmAclPkgStore}/entry.js', 'utf8')
  `)
  if (!readStore.ok) {
    throw new Error(`npm guest should read store: ${readStore.error}`)
  }
  const writeSrc = await npmAclInstance.eval(`
    var fs = require('fs')
    fs.writeFileSync('src.js', 'ok')
    'done'
  `)
  if (!writeSrc.ok || writeSrc.value !== 'done') {
    throw new Error(`npm guest should write project src: ${JSON.stringify(writeSrc)}`)
  }
  const denyNm = await npmAclInstance.eval(`
    var fs = require('fs')
    try {
      fs.writeFileSync('node_modules/acl-smoke/hack.js', 'x')
      'allowed'
    } catch (e) {
      e.code || e.message
    }
  `)
  if (denyNm.ok && denyNm.value === 'allowed') {
    throw new Error('npm guest must not write node_modules')
  }
  const denyStore = await npmAclInstance.eval(`
    var fs = require('fs')
    try {
      fs.writeFileSync('${npmAclPkgStore}/hack.js', 'x')
      'allowed'
    } catch (e) {
      e.code || e.message
    }
  `)
  if (denyStore.ok && denyStore.value === 'allowed') {
    throw new Error('npm guest must not write store path')
  }
  npmAclInstance.destroy()
  try {
    await filesRemove(npmAclProject)
    await filesRemove(npmAclFakeStoreRoot)
  } catch {
    // best-effort
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

async function testBinShimParse() {
  const basedir = '/proj/node_modules/.bin'
  const pnpmShim = `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")
if [ -x "$basedir/node" ]; then
  exec "$basedir/node"  "$basedir/../.pnpm/typescript@6.0.3/node_modules/typescript/bin/tsc" "$@"
else
  exec node  "$basedir/../.pnpm/typescript@6.0.3/node_modules/typescript/bin/tsc" "$@"
fi
`
  if (!looksLikeShellBinShim(pnpmShim)) {
    throw new Error('expected pnpm shim to look like shell bin shim')
  }
  const resolved = extractNodePathFromBinShim(pnpmShim, basedir)
  const expected =
    '/proj/node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/bin/tsc'
  if (resolved !== expected) {
    throw new Error(`unexpected shim resolve: ${resolved} (want ${expected})`)
  }

  const nodeShebang = `#!/usr/bin/env node
require('../lib/tsc.js')
`
  if (looksLikeShellBinShim(nodeShebang)) {
    throw new Error('node shebang entry should not look like shell shim')
  }

  if (
    !isDeprecatedNpmTscPlaceholderSource(
      'This is not the tsc command you are looking for',
    )
  ) {
    throw new Error('expected placeholder detector to match')
  }

  console.log('bin-shim parse smoke test passed')
}

async function main() {
  await testBinShimParse()
  await testSandbox()
  await testInstance()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
