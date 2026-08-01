/**
 * 终端 instant 壳层冒烟。
 * 运行：node --experimental-strip-types src/terminal/instant-shell/instant-shell.smoke-test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesCreateText, filesMkdir, filesRemove, filesStat } from '../../apps/files/files-api.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { createQuickJsInstance } from '../../quickjs/quickjs-instance.ts'
import { createInstantShellApi } from './instant-shell-host.ts'
import type { InstantShellHost } from './instant-shell-types.ts'
import { normalizeInstantShellUrl } from './instant-shell-url.ts'

registerFileOpenHandler({
  appId: 'textedit',
  extensions: ['txt'],
  rank: 10,
})

const ROOT = '/user/instant-shell-smoke'

async function resetRoot(): Promise<void> {
  const existing = await filesStat(ROOT)
  if (existing !== undefined) {
    await filesRemove(ROOT)
  }
  await filesMkdir(ROOT)
}

function createMockHost(overrides?: Partial<InstantShellHost>): InstantShellHost & {
  calls: string[]
} {
  const calls: string[] = []
  const host: InstantShellHost & { calls: string[] } = {
    calls,
    openApp: (appId, options) => {
      calls.push(`openApp:${appId}:${JSON.stringify(options ?? {})}`)
    },
    openGeneratedApp: (appId, title) => {
      calls.push(`openGeneratedApp:${appId}:${title}`)
    },
    openExtApp: (appId, title) => {
      calls.push(`openExtApp:${appId}:${title}`)
    },
    listApps: () => [
      { id: 'settings', name: '系统设置', kind: 'builtin' },
      { id: 'files', name: '文件', kind: 'builtin' },
      { id: 'browser', name: '网页浏览器', kind: 'builtin' },
    ],
    listWindows: () => [
      {
        windowId: 'files-1',
        appId: 'files',
        title: '文件',
        minimized: false,
        maximized: false,
        fullscreen: false,
        zIndex: 1,
      },
    ],
    resolveTarget: (target) => {
      if (target === 'files-1') {
        return { type: 'window', windowId: 'files-1', appId: 'files' }
      }
      return { type: 'app', appId: target, windowId: target === 'files' ? 'files-1' : undefined }
    },
    focusWindow: (windowId) => {
      calls.push(`focusWindow:${windowId}`)
    },
    closeWindow: (windowId) => {
      calls.push(`closeWindow:${windowId}`)
    },
    closeWindowsForApp: (appId) => {
      calls.push(`closeWindowsForApp:${appId}`)
    },
    minimizeWindow: (windowId) => {
      calls.push(`minimizeWindow:${windowId}`)
    },
    restoreWindow: (windowId) => {
      calls.push(`restoreWindow:${windowId}`)
    },
    toggleFullscreen: (windowId) => {
      calls.push(`toggleFullscreen:${windowId}`)
    },
    toggleMaximize: (windowId) => {
      calls.push(`toggleMaximize:${windowId}`)
    },
    getCwd: () => ROOT,
    getFsMode: () => 'normal' as const,
    getTerminalSessionId: () => 'smoke-session',
    noteExternalChangeSet: () => undefined,
    isBusy: () => false,
    confirmClose: async () => true,
    ...overrides,
  }
  return host
}

async function testApiOpenAppAndUrl(): Promise<void> {
  const host = createMockHost()
  const api = createInstantShellApi(host)
  await api.openApp('settings')
  await api.openUrl('example.com/path')
  assert.equal(host.calls[0], 'openApp:settings:{}')
  assert.equal(
    host.calls[1],
    `openApp:chromo:${JSON.stringify({ url: normalizeInstantShellUrl('example.com/path') })}`,
  )
  console.log('ok: createInstantShellApi openApp / openUrl')
}

async function testApiOpenPathFileAndFolder(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/note.txt`, 'hello')
  const host = createMockHost()
  const api = createInstantShellApi(host)
  await api.openPath(`${ROOT}/note.txt`)
  await api.openPath(ROOT)
  assert.deepEqual(host.calls[0], `openApp:textedit:${JSON.stringify({ documentId: `${ROOT}/note.txt` })}`)
  assert.deepEqual(host.calls[1], `openApp:files:${JSON.stringify({ documentId: ROOT })}`)
  console.log('ok: createInstantShellApi openPath file/folder')
}

async function testCloseConfirmWhenBusy(): Promise<void> {
  const host = createMockHost({
    isBusy: () => true,
    confirmClose: async () => false,
  })
  const api = createInstantShellApi(host)
  await assert.rejects(() => api.close('files'), /用户取消/)
  assert.equal(host.calls.length, 0)

  const host2 = createMockHost({
    isBusy: () => true,
    confirmClose: async () => true,
  })
  const api2 = createInstantShellApi(host2)
  await api2.close('files')
  assert.deepEqual(host2.calls, ['closeWindowsForApp:files'])
  console.log('ok: close confirms when busy')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function testInjectInstantGlobal(): Promise<void> {
  await resetRoot()
  const host = createMockHost()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    cwd: ROOT,
    fsMode: 'normal',
    timeoutMs: 10_000,
    instantShellHost: host,
  })
  try {
    const started = await instance.eval(`
      var __instantDone = false
      var __instantResult = null
      var __instantError = null
      ;(async function () {
        try {
          if (typeof instant !== 'object' || instant === null) throw new Error('instant missing')
          await instant.openApp('settings')
          await instant.openUrl('https://example.com')
          var apps = await instant.listApps()
          var windows = await instant.listWindows()
          __instantResult = { apps: apps.length, windows: windows.length }
        } catch (e) {
          __instantError = String(e && e.message ? e.message : e)
        } finally {
          __instantDone = true
        }
      })()
      'started'
    `)
    assert.equal(started.ok, true)
    for (let i = 0; i < 50; i += 1) {
      await sleep(20)
      const done = await instance.eval('__instantDone')
      if (done.ok && done.value === true) {
        break
      }
    }
    const result = await instance.eval(
      '__instantError ? { error: __instantError } : __instantResult',
    )
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.value, { apps: 3, windows: 1 })
    }
    assert.ok(host.calls.includes('openApp:settings:{}'))
    assert.ok(host.calls.some((line) => line.startsWith('openApp:chromo:') || line.startsWith('openApp:browser:')))
  } finally {
    instance.destroy()
  }
  console.log('ok: inject globalThis.instant')
}

async function testInjectAbsentByDefault(): Promise<void> {
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    cwd: ROOT,
    timeoutMs: 5_000,
  })
  try {
    const result = await instance.eval(`typeof instant`)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value, 'undefined')
    }
  } finally {
    instance.destroy()
  }
  console.log('ok: instant absent without host')
}

async function testApiGrep(): Promise<void> {
  await resetRoot()
  await filesMkdir(`${ROOT}/src`)
  await filesCreateText(
    `${ROOT}/src/needle.ts`,
    'const alpha = 1\nexport const findMeNeedleHere = true\nconst beta = 2\n',
  )
  await filesCreateText(`${ROOT}/src/other.ts`, 'export const unrelated = 0\n')

  const host = createMockHost()
  const api = createInstantShellApi(host)
  const hit = await api.grep('findMeNeedleHere')
  assert.equal(hit.matches.length, 1)
  assert.equal(hit.matches[0]?.path, `${ROOT}/src/needle.ts`)
  assert.equal(hit.matches[0]?.line, 2)
  assert.ok(hit.matches[0]?.preview.includes('findMeNeedleHere'))
  assert.equal(hit.truncated, false)
  assert.ok(hit.scannedFiles >= 1)

  const miss = await api.grep('definitelyNotPresentXYZ')
  assert.equal(miss.matches.length, 0)

  const scoped = await api.grep('findMeNeedleHere', { path: 'src/needle.ts' })
  assert.equal(scoped.matches.length, 1)
  assert.equal(scoped.matches[0]?.path, `${ROOT}/src/needle.ts`)

  console.log('ok: createInstantShellApi grep')
}

async function testInjectGrep(): Promise<void> {
  await resetRoot()
  await filesCreateText(`${ROOT}/hit.js`, 'line1\nconst GREP_SMOKE_TOKEN = 42\nline3\n')

  const host = createMockHost()
  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    cwd: ROOT,
    fsMode: 'normal',
    timeoutMs: 10_000,
    instantShellHost: host,
  })
  try {
    const started = await instance.eval(`
      var __grepDone = false
      var __grepResult = null
      var __grepError = null
      ;(async function () {
        try {
          var r = await instant.grep('GREP_SMOKE_TOKEN')
          var empty = await instant.grep('NO_SUCH_TOKEN_ZZZ')
          __grepResult = {
            path: r.matches[0] && r.matches[0].path,
            line: r.matches[0] && r.matches[0].line,
            preview: r.matches[0] && r.matches[0].preview,
            emptyCount: empty.matches.length,
            truncated: r.truncated,
          }
        } catch (e) {
          __grepError = String(e && e.message ? e.message : e)
        } finally {
          __grepDone = true
        }
      })()
      'started'
    `)
    assert.equal(started.ok, true)
    for (let i = 0; i < 50; i += 1) {
      await sleep(20)
      const done = await instance.eval('__grepDone')
      if (done.ok && done.value === true) {
        break
      }
    }
    const result = await instance.eval('__grepError ? { error: __grepError } : __grepResult')
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.value, {
        path: `${ROOT}/hit.js`,
        line: 2,
        preview: 'const GREP_SMOKE_TOKEN = 42',
        emptyCount: 0,
        truncated: false,
      })
    }
  } finally {
    instance.destroy()
  }
  console.log('ok: inject instant.grep')
}

async function testApiAndInjectWish(): Promise<void> {
  await resetRoot()
  const host = createMockHost({
    getFsMode: () => 'readonly',
    getTerminalSessionId: () => 'smoke-wish-session',
  })
  const api = createInstantShellApi(host)
  const written = await api.wish({
    summary: '缺少原生 child_process.spawn',
    category: 'capability',
    blockedStep: '启动外部编译器',
    attempted: ['改用可用的 npm 脚本'],
  })
  assert.equal(written.duplicated, false)
  assert.equal(written.path, '/dev/terminal/wishlist.jsonl')

  const instance = await createQuickJsInstance({
    workspaceRoot: ROOT,
    cwd: ROOT,
    fsMode: 'readonly',
    timeoutMs: 10_000,
    instantShellHost: host,
  })
  try {
    const started = await instance.eval(`
      var __wishDone = false
      var __wishResult = null
      var __wishError = null
      ;(async function () {
        try {
          var r = await instant.wish({
            summary: '缺少原生 child_process.spawn',
            category: 'capability',
            blockedStep: '再次启动编译器',
          })
          __wishResult = {
            duplicated: r.duplicated,
            wishId: r.wishId,
            path: r.path,
          }
        } catch (e) {
          __wishError = String(e && e.message ? e.message : e)
        } finally {
          __wishDone = true
        }
      })()
      'started'
    `)
    assert.equal(started.ok, true)
    for (let i = 0; i < 50; i += 1) {
      await sleep(20)
      const done = await instance.eval('__wishDone')
      if (done.ok && done.value === true) {
        break
      }
    }
    const result = await instance.eval('__wishError ? { error: __wishError } : __wishResult')
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.value, {
        duplicated: true,
        wishId: written.wishId,
        path: '/dev/terminal/wishlist.jsonl',
      })
    }
  } finally {
    instance.destroy()
  }
  console.log('ok: createInstantShellApi wish + inject instant.wish')
}

async function main(): Promise<void> {
  await testApiOpenAppAndUrl()
  await testApiOpenPathFileAndFolder()
  await testCloseConfirmWhenBusy()
  await testInjectInstantGlobal()
  await testInjectAbsentByDefault()
  await testApiGrep()
  await testInjectGrep()
  await testApiAndInjectWish()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
