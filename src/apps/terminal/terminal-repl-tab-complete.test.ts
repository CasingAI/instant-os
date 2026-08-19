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
  applyReplCompletion,
  buildReplCompletionEval,
  completeHostDotCommands,
  isHostDotCommandLine,
  parseReplCompletionTarget,
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
  })
  assert.deepEqual(parseReplCompletionTarget('instant.'), {
    objectExpr: 'instant',
    prefix: '',
    from: 'instant.'.length,
  })
  assert.deepEqual(parseReplCompletionTarget('instant.op'), {
    objectExpr: 'instant',
    prefix: 'op',
    from: 'instant.'.length,
  })
  assert.deepEqual(parseReplCompletionTarget('foo(instant.git.cl'), {
    objectExpr: 'instant.git',
    prefix: 'cl',
    from: 'foo(instant.git.'.length,
  })
  assert.equal(parseReplCompletionTarget('foo().bar'), undefined)
  assert.equal(parseReplCompletionTarget('foo?.bar'), undefined)
  console.log('ok: parseReplCompletionTarget')
}

function testApply(): void {
  const from = 'instant.'.length
  const unique = applyReplCompletion('instant.op', from, 'op', ['openApp'])
  assert.equal(unique.nextDraft, 'instant.openApp')
  assert.equal(unique.candidates, undefined)

  const shared = applyReplCompletion('instant.op', from, 'op', ['openApp', 'openPath'])
  assert.equal(shared.nextDraft, 'instant.open')
  assert.equal(shared.candidates, undefined)

  const listed = applyReplCompletion('instant.open', from, 'open', ['openApp', 'openPath'])
  assert.equal(listed.nextDraft, 'instant.open')
  assert.deepEqual(listed.candidates, ['openApp', 'openPath'])
  console.log('ok: applyReplCompletion')
}

function testHostDot(): void {
  assert.equal(isHostDotCommandLine('.re'), true)
  assert.equal(isHostDotCommandLine('instant.re'), false)
  const result = completeHostDotCommands('.re')
  assert.equal(result.nextDraft, '.reset')
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

    const applied = applyReplCompletion(
      'instant.op',
      'instant.'.length,
      'op',
      names,
    )
    assert.equal(applied.nextDraft, 'instant.open')

    const defined = await instance.eval('var box = { zed: 1 }')
    assert.equal(defined.ok, true, defined.ok ? '' : defined.error)
    const boxNames = await instance.eval(buildReplCompletionEval('box'), {
      silent: true,
      timeoutMs: 100,
    })
    assert.equal(boxNames.ok, true, boxNames.ok ? '' : boxNames.error)
    const boxList = boxNames.ok ? (boxNames.value as string[]) : []
    assert.ok(boxList.includes('zed'), `missing zed: ${boxList.join(',')}`)
    const boxApplied = applyReplCompletion('box.z', 'box.'.length, 'z', boxList)
    assert.equal(boxApplied.nextDraft, 'box.zed')
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
  testApply()
  testHostDot()
  await testInstantAndUserObject()
  await testSilentSkipsJournal()
  console.log('all repl tab-complete tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
