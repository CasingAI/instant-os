/**
 * instant.wish：校验、截断、去重、只读终端可许愿。
 *
 * 运行：node --experimental-strip-types src/terminal/instant-shell/wishlist.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { resetFilesDbForTests } from '../../apps/files/files-storage.ts'
import { invalidateFilesVfsPathCaches, resolveNodeByAbsolutePath } from '../../apps/files/files-vfs.ts'
import { readBlobBytes } from '../../apps/files/files-storage.ts'
import { createInstantShellApi } from './instant-shell-host.ts'
import type { InstantShellHost } from './instant-shell-types.ts'
import type { TerminalChangeSet } from '../terminal-changeset.ts'
import type { TerminalFsMode } from '../terminal-fs-mode.ts'
import {
  WISHLIST_MAX_LINES,
  WISHLIST_PATH,
  WISH_SUMMARY_MAX,
  normalizeWishOptions,
  normalizeWishSummaryKey,
  trimWishlistRecords,
  type WishlistRecord,
} from './wishlist-store.ts'

function createMockHost(overrides?: Partial<InstantShellHost>): InstantShellHost {
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
    getCwd: () => '/user/project',
    getFsMode: () => 'readonly' as TerminalFsMode,
    getTerminalSessionId: () => 'wish-test-session',
    noteExternalChangeSet: (_changeSet: TerminalChangeSet) => undefined,
    isBusy: () => false,
    confirmClose: async () => true,
    ...overrides,
  }
}

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

{
  assert.throws(
    () => normalizeWishOptions(null as unknown as { summary: string; category: 'other'; blockedStep: string }),
    (error: unknown) => error instanceof Error && error.message === 'wish 选项必须是对象',
  )
  assert.throws(
    () =>
      normalizeWishOptions({
        summary: '   ',
        category: 'capability',
        blockedStep: 'do something',
      }),
    (error: unknown) => error instanceof Error && error.message === 'summary 不能为空',
  )
  assert.throws(
    () =>
      normalizeWishOptions({
        summary: 'need X',
        category: 'nope' as 'other',
        blockedStep: 'step',
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'category 必须是 capability | policy | network | data | tooling | other',
  )
  assert.throws(
    () =>
      normalizeWishOptions({
        summary: 'need X',
        category: 'capability',
        blockedStep: '',
      }),
    (error: unknown) => error instanceof Error && error.message === 'blockedStep 不能为空',
  )

  const long = 'a'.repeat(WISH_SUMMARY_MAX + 40)
  const normalized = normalizeWishOptions({
    summary: `  ${long}  `,
    category: 'tooling',
    blockedStep: ' run build ',
    attempted: ['try A', '', 'try B', 'try C', 'try D', 'try E', 'try F'],
    detail: '  more  ',
  })
  assert.equal(normalized.summary.length, WISH_SUMMARY_MAX)
  assert.equal(normalized.blockedStep, 'run build')
  assert.equal(normalized.attempted?.length, 5)
  assert.equal(normalized.detail, 'more')
  assert.equal(normalizeWishSummaryKey('  Foo   Bar '), 'foo bar')

  console.log('ok: normalizeWishOptions validation and truncation')
}

{
  const base: WishlistRecord = {
    id: '1',
    createdAt: 1,
    summary: 's',
    category: 'other',
    blockedStep: 'b',
    cwd: '/',
    fsMode: 'readonly',
    terminalSessionId: 's',
  }
  const many = Array.from({ length: WISHLIST_MAX_LINES + 20 }, (_, i) => ({
    ...base,
    id: String(i),
    summary: `wish-${i}`,
  }))
  const trimmed = trimWishlistRecords(many)
  assert.equal(trimmed.length, WISHLIST_MAX_LINES)
  assert.equal(trimmed[0]?.summary, `wish-20`)
  assert.equal(trimmed[trimmed.length - 1]?.summary, `wish-${WISHLIST_MAX_LINES + 19}`)
  console.log('ok: trimWishlistRecords keeps last lines')
}

{
  await resetState()
  const host = createMockHost({ getFsMode: () => 'readonly' })
  const api = createInstantShellApi(host)

  const first = await api.wish({
    summary: '缺少真实 git binary',
    category: 'capability',
    blockedStep: '在本地仓库执行 git status',
    attempted: ['改用 instant.git.status'],
  })
  assert.equal(first.duplicated, false)
  assert.equal(first.path, WISHLIST_PATH)
  assert.ok(first.wishId)
  assert.equal(first.summary, '缺少真实 git binary')

  const node = await resolveNodeByAbsolutePath(WISHLIST_PATH)
  assert.ok(node)
  assert.equal(node?.kind, 'file')
  assert.equal(node?.attributes.writable, false)
  const bytes = node ? await readBlobBytes(node.id) : undefined
  assert.ok(bytes)
  const text = new TextDecoder().decode(bytes)
  const line = JSON.parse(text.trim()) as WishlistRecord
  assert.equal(line.id, first.wishId)
  assert.equal(line.fsMode, 'readonly')
  assert.equal(line.terminalSessionId, 'wish-test-session')
  assert.equal(line.cwd, '/user/project')

  const dup = await api.wish({
    summary: '缺少真实  git  binary',
    category: 'capability',
    blockedStep: '再次尝试 git',
  })
  assert.equal(dup.duplicated, true)
  assert.equal(dup.wishId, first.wishId)

  const other = await api.wish({
    summary: '缺少真实 git binary',
    category: 'tooling',
    blockedStep: '不同类别应新记',
  })
  assert.equal(other.duplicated, false)
  assert.notEqual(other.wishId, first.wishId)

  const afterBytes = await readBlobBytes(node!.id)
  const lines = new TextDecoder()
    .decode(afterBytes)
    .split('\n')
    .filter((l) => l.trim())
  assert.equal(lines.length, 2)

  console.log('ok: wish append, readonly, and session dedupe')
}

console.log('wishlist.test.ts: all passed')
