/**
 * 终端受控模式冒烟：记变更 / 回滚 / 只读拒绝 / 普通不记账。
 * 运行：node --experimental-strip-types src/terminal/terminal-controlled.smoke-test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  filesCreateText,
  filesMkdir,
  filesReadText,
  filesRemove,
  filesStat,
} from '../apps/files/files-api.ts'
import { createQuickJsInstance } from '../quickjs/quickjs-instance.ts'
import { loadTerminalChangeSession } from './terminal-changeset-store.ts'

const ROOT = '/user/tcs-smoke'

async function resetRoot(): Promise<void> {
  const existing = await filesStat(ROOT)
  if (existing !== undefined) {
    await filesRemove(ROOT)
  }
  await filesMkdir(ROOT)
}

async function testReadonlyRejectsWrite(): Promise<void> {
  await resetRoot()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'readonly',
    timeoutMs: 10_000,
  })
  const result = await instance.eval(`
    var fs = require('fs')
    try {
      fs.writeFileSync('x.txt', 'nope')
      'wrote'
    } catch (e) {
      String(e && e.code ? e.code : e)
    }
  `)
  instance.destroy()
  assert.equal(result.ok, true)
  assert.equal(result.value, 'EACCES')
  assert.equal(result.changes, undefined)
  assert.equal(await filesStat(`${ROOT}/x.txt`), undefined)
  console.log('ok: readonly rejects write')
}

async function testNormalDoesNotTrack(): Promise<void> {
  await resetRoot()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'normal',
    timeoutMs: 10_000,
  })
  const result = await instance.eval(`
    require('fs').writeFileSync('plain.txt', 'hello')
    'ok'
  `)
  instance.destroy()
  assert.equal(result.ok, true)
  assert.equal(result.changes, undefined)
  assert.equal(await filesReadText(`${ROOT}/plain.txt`), 'hello')
  console.log('ok: normal writes without changeset')
}

async function testControlledTracksAndReverts(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/keep.txt`, 'before')

  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'controlled',
    timeoutMs: 15_000,
  })

  const result = await instance.eval(`
    var fs = require('fs')
    fs.writeFileSync('keep.txt', 'after')
    fs.writeFileSync('new.txt', 'brand')
    'done'
  `)

  assert.equal(result.ok, true)
  assert.ok(result.changes)
  assert.ok(result.changes!.changes.length >= 2)
  const kinds = new Map(result.changes!.changes.map((c) => [c.path, c.kind]))
  assert.equal(kinds.get(`${ROOT}/keep.txt`), 'modified')
  assert.equal(kinds.get(`${ROOT}/new.txt`), 'added')

  const session = await loadTerminalChangeSession(result.changes!.sessionId)
  assert.ok(session)
  assert.equal(await filesReadText(`${ROOT}/keep.txt`), 'after')
  assert.equal(await filesReadText(`${ROOT}/new.txt`), 'brand')

  await instance.revertLastChanges()
  assert.equal(instance.getLastChanges(), undefined)
  assert.equal(await filesReadText(`${ROOT}/keep.txt`), 'before')
  assert.equal(await filesStat(`${ROOT}/new.txt`), undefined)
  assert.equal(await loadTerminalChangeSession(result.changes!.sessionId), undefined)

  instance.destroy()
  console.log('ok: controlled tracks and reverts')
}

async function testReadOutsideWorkspaceWriteDenied(): Promise<void> {
  const PROJECT = `${ROOT}/project`
  const OTHER = `${ROOT}/other`
  await resetRoot()
  await filesMkdir(PROJECT)
  await filesMkdir(OTHER)
  await filesCreateText(`${OTHER}/ref.txt`, 'outside')

  const instance = await createQuickJsInstance({
    workspaceRoot: PROJECT,
    fsMode: 'controlled',
    timeoutMs: 10_000,
  })

  const readResult = await instance.eval(`
    require('fs').readFileSync('${OTHER}/ref.txt', 'utf8')
  `)
  assert.equal(readResult.ok, true)
  assert.equal(readResult.value, 'outside')

  const writeResult = await instance.eval(`
    try {
      require('fs').writeFileSync('${OTHER}/bad.txt', 'nope')
      'wrote'
    } catch (e) {
      String(e && e.code ? e.code : e)
    }
  `)
  instance.destroy()
  assert.equal(writeResult.ok, true)
  assert.equal(writeResult.value, 'EACCES')
  assert.equal(await filesStat(`${OTHER}/bad.txt`), undefined)
  console.log('ok: read outside workspace, write denied outside')
}

async function testReadonlyAllowsSessionTmpWrite(): Promise<void> {
  await resetRoot()
  const sessionId = 'tcs-readonly-tmp'
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'readonly',
    terminalSessionId: sessionId,
    timeoutMs: 10_000,
  })
  const result = await instance.eval(`
    var fs = require('fs')
    var os = require('os')
    var path = require('path')
    var tmp = os.tmpdir()
    var denied
    try {
      fs.writeFileSync('x.txt', 'nope')
      denied = 'wrote-workspace'
    } catch (e) {
      denied = String(e && e.code ? e.code : e)
    }
    fs.writeFileSync(path.join(tmp, 'spill.txt'), 'ok')
    ;({
      denied: denied,
      tmpdir: tmp,
      spill: fs.readFileSync(path.join(tmp, 'spill.txt'), 'utf8'),
    })
  `)
  instance.destroy()
  assert.equal(result.ok, true)
  const value = result.value as { denied: string; tmpdir: string; spill: string }
  assert.equal(value.denied, 'EACCES')
  assert.equal(value.tmpdir, `/tmp/Terminal/${sessionId}`)
  assert.equal(value.spill, 'ok')
  assert.equal(await filesStat(`${ROOT}/x.txt`), undefined)
  assert.equal(await filesReadText(`/tmp/Terminal/${sessionId}/spill.txt`), 'ok')
  console.log('ok: readonly allows session tmp write')
}

async function testControlledTmpNotInChangeset(): Promise<void> {
  await resetRoot()
  const sessionId = 'tcs-ctrl-tmp'
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    fsMode: 'controlled',
    terminalSessionId: sessionId,
    timeoutMs: 10_000,
  })
  const result = await instance.eval(`
    var fs = require('fs')
    var os = require('os')
    var path = require('path')
    fs.writeFileSync('tracked.txt', 'ws')
    fs.writeFileSync(path.join(os.tmpdir(), 'scratch.txt'), 'tmp')
    'ok'
  `)
  instance.destroy()
  assert.equal(result.ok, true)
  assert.ok(result.changes)
  const paths = result.changes!.changes.map((c) => c.path)
  assert.ok(paths.some((p) => p.endsWith('/tracked.txt')))
  assert.ok(!paths.some((p) => p.includes('/tmp/')))
  assert.equal(await filesReadText(`/tmp/Terminal/${sessionId}/scratch.txt`), 'tmp')
  console.log('ok: controlled tmp writes excluded from changeset')
}

async function main(): Promise<void> {
  await testReadonlyRejectsWrite()
  await testReadonlyAllowsSessionTmpWrite()
  await testNormalDoesNotTrack()
  await testControlledTracksAndReverts()
  await testControlledTmpNotInChangeset()
  await testReadOutsideWorkspaceWriteDenied()
  console.log('terminal-controlled: all passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
