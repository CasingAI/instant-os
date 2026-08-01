/**
 * instant.git 薄层：参数校验 + 只读门禁。
 *
 * 运行：node --experimental-strip-types src/terminal/instant-shell/instant-shell-git.test.ts
 */
import assert from 'node:assert/strict'
import { GITHUB_GIT_READONLY_MUTATION_MESSAGE } from '../../apps/github-desktop/github-git.ts'
import { GITHUB_USER_ROOT } from '../../apps/github-desktop/github-repo-paths.ts'
import { createInstantShellApi } from './instant-shell-host.ts'
import type { InstantShellHost } from './instant-shell-types.ts'
import type { TerminalChangeSet } from '../terminal-changeset.ts'
import type { TerminalFsMode } from '../terminal-fs-mode.ts'

function createMockHost(overrides?: Partial<InstantShellHost>): InstantShellHost & {
  noted: TerminalChangeSet[]
} {
  const noted: TerminalChangeSet[] = []
  const host: InstantShellHost & { noted: TerminalChangeSet[] } = {
    noted,
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
    getCwd: () => `${GITHUB_USER_ROOT}/acme/demo`,
    getFsMode: () => 'readonly' as TerminalFsMode,
    getTerminalSessionId: () => 'test-session',
    noteExternalChangeSet: (changeSet) => {
      noted.push(changeSet)
    },
    isBusy: () => false,
    confirmClose: async () => true,
    ...overrides,
  }
  return host
}

{
  const host = createMockHost()
  const api = createInstantShellApi(host)

  assert.throws(
    () => {
      void api.git.commit({ message: 1 as unknown as string })
    },
    (error: unknown) => error instanceof Error && error.message === 'message 必须是字符串',
  )

  assert.throws(
    () => {
      void api.git.commit(null as unknown as { message: string })
    },
    (error: unknown) => error instanceof Error && error.message === 'commit 选项必须是对象',
  )

  assert.throws(
    () => {
      void api.git.discard('x' as unknown as string[])
    },
    (error: unknown) => error instanceof Error && error.message === 'paths 必须是字符串数组',
  )

  assert.throws(
    () => {
      void api.git.switchBranch('')
    },
    (error: unknown) => error instanceof Error && error.message === 'branch 必须是非空字符串',
  )

  console.log('ok: instant.git argument validation')
}

{
  const host = createMockHost({ getFsMode: () => 'readonly' })
  const api = createInstantShellApi(host)

  await assert.rejects(
    () => api.git.commit({ message: 'x', all: true }),
    (error: unknown) =>
      error instanceof Error && error.message === GITHUB_GIT_READONLY_MUTATION_MESSAGE,
  )
  await assert.rejects(
    () => api.git.fetch(),
    (error: unknown) =>
      error instanceof Error && error.message === GITHUB_GIT_READONLY_MUTATION_MESSAGE,
  )
  await assert.rejects(
    () => api.git.push(),
    (error: unknown) =>
      error instanceof Error && error.message === GITHUB_GIT_READONLY_MUTATION_MESSAGE,
  )
  await assert.rejects(
    () => api.git.clone({ owner: 'acme', repo: 'demo' }),
    (error: unknown) =>
      error instanceof Error && error.message === GITHUB_GIT_READONLY_MUTATION_MESSAGE,
  )

  assert.equal(host.noted.length, 0)
  console.log('ok: instant.git readonly mutation gate')
}
