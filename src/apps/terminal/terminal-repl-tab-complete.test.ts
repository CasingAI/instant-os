/**
 * InstantREPL Tab 补全：解析 / apply 与 QuickJS 运行时反射冒烟。
 * 运行：node --experimental-strip-types src/apps/terminal/terminal-repl-tab-complete.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesMkdir, filesRemove, filesStat } from '../files/files-api.ts'
import { createQuickJsInstance } from '../../quickjs/quickjs-instance.ts'
import type { InstantShellHost } from '../../terminal/instant-shell/instant-shell-types.ts'
import {
  buildReplCompletionEval,
  caretFromReplCompletionCycle,
  createReplCompletionCycle,
  draftFromReplCompletionCycle,
  formatReplCompletionHint,
  HOST_REPL_DOT_COMMANDS,
  isHostDotCommandLine,
  parseHostDotTarget,
  parseReplCompletionTarget,
  stepReplCompletionCycle,
} from './terminal-repl-tab-complete.ts'

const ROOT = '/user/trepl-tab-complete'

async function resetRoot(): Promise<void> {
  const existing = await filesStat(ROOT)
  if (existing !== undefined) {
    await filesRemove(ROOT)
  }
  await filesMkdir(ROOT)
}

function createMockHost(): InstantShellHost {
  return {
    openApp: () => undefined,
    openGeneratedApp: () => undefined,
    openExtApp: () => undefined,
    listApps: () => [],
    listWindows: () => [],
    resolveTarget: (target) => ({ type: 'app', appId: target }),
    focusWindow: () => undefined,
    closeWindow: () => undefined,
    closeWindowsForApp: () => undefined,
    minimizeWindow: () => undefined,
    restoreWindow: () => undefined,
    toggleFullscreen: () => undefined,
    toggleMaximize: () => undefined,
    getCwd: () => ROOT,
    getFsMode: () => 'normal',
    getTerminalSessionId: () => 'tab-complete-session',
    noteExternalChangeSet: () => undefined,
    isBusy: () => false,
    confirmClose: async () => true,
  }
}

function testParse(): void {
  assert.deepEqual(parseReplCompletionTarget('ins'), {
    objectExpr: '',
    prefix: 'ins',
    from: 0,
    to: 3,
  })
  assert.deepEqual(parseReplCompletionTarget('instant.'), {
    objectExpr: 'instant',
    prefix: '',
    from: 'instant.'.length,
    to: 'instant.'.length,
  })
  assert.deepEqual(parseReplCompletionTarget('instant.op'), {
    objectExpr: 'instant',
    prefix: 'op',
    from: 'instant.'.length,
    to: 'instant.op'.length,
  })
  assert.deepEqual(parseReplCompletionTarget('foo(instant.git.cl'), {
    objectExpr: 'instant.git',
    prefix: 'cl',
    from: 'foo(instant.git.'.length,
    to: 'foo(instant.git.cl'.length,
  })
  const insideCall = 'console.log(glo)'
  const gloFrom = insideCall.indexOf('glo')
  assert.deepEqual(parseReplCompletionTarget(insideCall), {
    objectExpr: '',
    prefix: 'glo',
    from: gloFrom,
    to: gloFrom + 3,
  })
  assert.deepEqual(parseReplCompletionTarget(insideCall, gloFrom + 3), {
    objectExpr: '',
    prefix: 'glo',
    from: gloFrom,
    to: gloFrom + 3,
  })
  assert.equal(parseReplCompletionTarget('foo().bar'), undefined)
  assert.equal(parseReplCompletionTarget('foo?.bar'), undefined)
  console.log('ok: parseReplCompletionTarget')
}

function testCycle(): void {
  const line = 'console.log(glo)'
  const target = parseReplCompletionTarget(line)
  assert.ok(target)
  const cycle = createReplCompletionCycle(line, target!, ['global', 'globalThis'], 1)
  assert.ok(cycle)
  assert.equal(draftFromReplCompletionCycle(cycle!), 'console.log(global)')
  assert.equal(caretFromReplCompletionCycle(cycle!), 'console.log(global'.length)
  const next = stepReplCompletionCycle(cycle!, 1)
  assert.equal(draftFromReplCompletionCycle(next), 'console.log(globalThis)')
  const back = stepReplCompletionCycle(next, -1)
  assert.equal(draftFromReplCompletionCycle(back), 'console.log(global)')
  assert.ok(formatReplCompletionHint(cycle!).includes('1/2'))
  console.log('ok: completion cycle')
}

function testHostDot(): void {
  assert.equal(isHostDotCommandLine('.re'), true)
  assert.equal(isHostDotCommandLine('instant.re'), false)
  const target = parseHostDotTarget('.re')
  assert.ok(target)
  const cycle = createReplCompletionCycle('.re', target!, HOST_REPL_DOT_COMMANDS, 1)
  assert.ok(cycle)
  assert.equal(draftFromReplCompletionCycle(cycle!), '.reset')
  const flipTarget = parseHostDotTarget('.fl')
  assert.ok(flipTarget)
  const flipCycle = createReplCompletionCycle('.fl', flipTarget!, HOST_REPL_DOT_COMMANDS, 1)
  assert.ok(flipCycle)
  assert.equal(draftFromReplCompletionCycle(flipCycle!), '.flip3d')
  console.log('ok: host dot commands')
}

async function testInstantAndUserObject(): Promise<void> {
  await resetRoot()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    cwd: ROOT,
    fsMode: 'normal',
    timeoutMs: 10_000,
    instantShellHost: createMockHost(),
  })
  try {
    const instantNames = await instance.eval(buildReplCompletionEval('instant'), {
      silent: true,
      timeoutMs: 100,
    })
    assert.equal(instantNames.ok, true, instantNames.ok ? '' : instantNames.error)
    assert.ok(Array.isArray(instantNames.ok ? instantNames.value : undefined))
    const names = instantNames.ok ? (instantNames.value as string[]) : []
    assert.ok(names.includes('openApp'), `missing openApp: ${names.join(',')}`)
    assert.ok(names.includes('openPath'), `missing openPath: ${names.join(',')}`)
    assert.ok(!names.includes('constructor'), `constructor should be hidden: ${names.join(',')}`)

    const applied = createReplCompletionCycle(
      'instant.op',
      { objectExpr: 'instant', prefix: 'op', from: 'instant.'.length, to: 'instant.op'.length },
      names,
      1,
    )
    assert.ok(applied)
    assert.equal(draftFromReplCompletionCycle(applied!), 'instant.openApp')

    const defined = await instance.eval('var box = { zed: 1 }')
    assert.equal(defined.ok, true, defined.ok ? '' : defined.error)
    const boxNames = await instance.eval(buildReplCompletionEval('box'), {
      silent: true,
      timeoutMs: 100,
    })
    assert.equal(boxNames.ok, true, boxNames.ok ? '' : boxNames.error)
    const boxList = boxNames.ok ? (boxNames.value as string[]) : []
    assert.ok(boxList.includes('zed'), `missing zed: ${boxList.join(',')}`)
    assert.ok(!boxList.includes('constructor'), `constructor should be hidden: ${boxList.join(',')}`)
    const boxApplied = createReplCompletionCycle(
      'box.z',
      { objectExpr: 'box', prefix: 'z', from: 'box.'.length, to: 'box.z'.length },
      boxList,
      1,
    )
    assert.ok(boxApplied)
    assert.equal(draftFromReplCompletionCycle(boxApplied!), 'box.zed')
  } finally {
    instance.destroy()
  }
  console.log('ok: QuickJS instant.* and user object')
}

async function testSilentSkipsJournal(): Promise<void> {
  await resetRoot()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    cwd: ROOT,
    fsMode: 'controlled',
    timeoutMs: 10_000,
    instantShellHost: createMockHost(),
  })
  try {
    const result = await instance.eval(buildReplCompletionEval('instant'), {
      silent: true,
      timeoutMs: 100,
    })
    assert.equal(result.ok, true, result.ok ? '' : result.error)
    assert.equal(result.ok ? result.changes : undefined, undefined)
    assert.equal(instance.getLastChanges(), undefined)
  } finally {
    instance.destroy()
  }
  console.log('ok: silent eval skips controlled journal')
}

async function main(): Promise<void> {
  testParse()
  testCycle()
  testHostDot()
  await testInstantAndUserObject()
  await testSilentSkipsJournal()
  console.log('all repl tab-complete tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
