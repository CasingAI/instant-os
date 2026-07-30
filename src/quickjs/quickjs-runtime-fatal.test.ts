/**
 * QuickJS 致命错误分类器单测。
 * 运行：pnpm test:quickjs-fatal
 */
import assert from 'node:assert/strict'
import {
  isQuickJsRuntimeFatalError,
  QuickJsRuntimeFatalError,
} from './quickjs-runtime-fatal.ts'
import { QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES } from './quickjs-quotas.ts'

function expectFatal(input: unknown, label: string): void {
  assert.equal(isQuickJsRuntimeFatalError(input), true, `expected fatal: ${label}`)
}

function expectNotFatal(input: unknown, label: string): void {
  assert.equal(isQuickJsRuntimeFatalError(input), false, `expected not fatal: ${label}`)
}

expectFatal('memory access out of bounds', 'oob string')
expectFatal(
  new Error(
    'Aborted(Assertion failed: p->ref_count == 0, at: ../../vendor/quickjs/quickjs.c,6009,free_zero_refcount)',
  ),
  'quickjs assert',
)
expectFatal(new Error('out of memory'), 'oom phrase')
expectFatal(new Error('RuntimeError: memory access out of bounds'), 'runtimeerror wrap')
expectFatal(new QuickJsRuntimeFatalError('already wrapped'), 'typed fatal')
expectFatal({ message: 'table index is out of bounds' }, 'message object')

expectNotFatal(new Error('ENOENT: no such file'), 'enoent')
expectNotFatal(new Error('timeout after 5000ms waiting for Promise'), 'timeout')
expectNotFatal('webview 返回值过大（3000000 字符，上限 2097152）', 'encode cap soft error')
expectNotFatal(new Error('room is full'), 'false OOM substring')
expectNotFatal(undefined, 'undefined')
expectNotFatal(null, 'null')

assert.equal(
  QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES,
  128 * 1024 * 1024,
  'default memory limit should be 128MiB',
)

console.log('quickjs-runtime-fatal: ok')
