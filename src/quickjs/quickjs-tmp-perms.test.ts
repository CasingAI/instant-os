/**
 * readonly / controlled 对 session tmp 的权限与路径约定单测（不启动 QuickJS WASM）。
 * 运行：node --experimental-strip-types src/quickjs/quickjs-tmp-perms.test.ts
 */
import assert from 'node:assert/strict'
import { assertFsPermission } from './quickjs-fs-path.ts'
import type { QuickJsHostPermissions } from './quickjs-instance-types.ts'
import { terminalTmpDir } from '../apps/files/files-tmp.ts'

function perms(partial: Partial<QuickJsHostPermissions>): QuickJsHostPermissions {
  return {
    fsReadRoots: partial.fsReadRoots ?? ['/'],
    fsWriteRoots: partial.fsWriteRoots ?? [],
    fsWriteDenyRoots: partial.fsWriteDenyRoots ?? [],
    network: false,
  }
}

function testReadonlySessionTmpWriteAllowed(): void {
  const sessionId = 'perm-sess'
  const tmp = terminalTmpDir(sessionId)
  const p = perms({ fsWriteRoots: [tmp] })
  assert.doesNotThrow(() => assertFsPermission(`${tmp}/a.txt`, 'write', p, 'writeFile'))
  assert.throws(
    () => assertFsPermission('/user/project/a.txt', 'write', p, 'writeFile'),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === 'EACCES',
  )
  console.log('ok: readonly session tmp write allowed, workspace denied')
}

function testControlledIncludesTmpAndWorkspace(): void {
  const tmp = terminalTmpDir('ctrl')
  const p = perms({ fsWriteRoots: ['/user/project', tmp] })
  assert.doesNotThrow(() => assertFsPermission('/user/project/a.txt', 'write', p, 'writeFile'))
  assert.doesNotThrow(() => assertFsPermission(`${tmp}/b.txt`, 'write', p, 'writeFile'))
  assert.throws(
    () => assertFsPermission('/user/other/a.txt', 'write', p, 'writeFile'),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === 'EACCES',
  )
  console.log('ok: controlled write roots include workspace + tmp')
}

testReadonlySessionTmpWriteAllowed()
testControlledIncludesTmpAndWorkspace()
console.log('quickjs-tmp-perms: all passed')
