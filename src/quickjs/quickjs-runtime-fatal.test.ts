/**
 * QuickJS 致命错误分类器单测。
 * 运行：pnpm test:quickjs-fatal
 */
import assert from 'node:assert/strict'
import {
  formatFatalErrorMessage,
  isQuickJsRuntimeFatalError,
  isQuickJsWasmBoundaryFatalError,
  QuickJsRuntimeFatalError,
} from './quickjs-runtime-fatal.ts'
import { QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES } from './quickjs-quotas.ts'
import { formatQuickJsBridgeErrorMessage } from './quickjs-bridge-error.ts'

function expectFatal(input: unknown, label: string): void {
  assert.equal(isQuickJsWasmBoundaryFatalError(input), true, `expected fatal: ${label}`)
  assert.equal(isQuickJsRuntimeFatalError(input), true, `alias expected fatal: ${label}`)
}

function expectNotFatal(input: unknown, label: string): void {
  assert.equal(isQuickJsWasmBoundaryFatalError(input), false, `expected not fatal: ${label}`)
  assert.equal(isQuickJsRuntimeFatalError(input), false, `alias expected not fatal: ${label}`)
}

expectFatal('memory access out of bounds', 'oob string')
expectFatal(
  new Error(
    'Aborted(Assertion failed: p->ref_count == 0, at: ../../vendor/quickjs/quickjs.c,6009,free_zero_refcount)',
  ),
  'quickjs c assert',
)
expectFatal(new Error('RuntimeError: memory access out of bounds'), 'runtimeerror wrap oob')
expectFatal(new QuickJsRuntimeFatalError('already wrapped'), 'typed fatal')
expectFatal({ message: 'table index is out of bounds' }, 'message object')
expectFatal(
  new Error('null function or function signature mismatch'),
  'signature mismatch',
)

if (typeof WebAssembly !== 'undefined' && typeof WebAssembly.RuntimeError === 'function') {
  expectFatal(new WebAssembly.RuntimeError('trap'), 'WebAssembly.RuntimeError')
}

expectNotFatal(new Error('Assertion failed: 1 === 2'), 'guest assert style')
expectNotFatal(new Error('RuntimeError: user code'), 'guest RuntimeError phrase')
expectNotFatal(new Error('unreachable'), 'generic unreachable')
expectNotFatal(new Error('out of memory'), 'generic oom phrase')
expectNotFatal(new Error('room is full'), 'false OOM substring')
expectNotFatal(
  formatQuickJsBridgeErrorMessage(
    'webview',
    new Error('返回值过大（3000000 字符，上限 2097152）'),
  ),
  'webview encode cap soft error',
)
expectNotFatal(new Error('ENOENT: no such file'), 'enoent')
expectNotFatal(new Error('timeout after 5000ms waiting for Promise'), 'timeout')
expectNotFatal(undefined, 'undefined')
expectNotFatal(null, 'null')

assert.equal(
  formatQuickJsBridgeErrorMessage('webview', new Error('url 不能为空')),
  '[webview] url 不能为空',
)
assert.equal(
  formatQuickJsBridgeErrorMessage('instant-shell', new Error('denied')),
  '[instant-shell] denied',
)
assert.equal(
  formatQuickJsBridgeErrorMessage('webview', new Error('[webview] already')),
  '[webview] already',
  'should not double-prefix',
)

assert.equal(
  QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES,
  128 * 1024 * 1024,
  'default memory limit should be 128MiB',
)

// formatFatalErrorMessage
assert.equal(
  formatFatalErrorMessage('memory access out of bounds'),
  'QuickJS 引擎内部崩溃（WASM 内存访问越界）',
  'oob string → friendly',
)
assert.equal(
  formatFatalErrorMessage(new Error('RuntimeError: memory access out of bounds')),
  'QuickJS 引擎内部崩溃（WASM 内存访问越界）',
  'oob error → friendly',
)
assert.equal(
  formatFatalErrorMessage(
    new Error('Aborted(Assertion failed: p->ref_count == 0, at: ../../vendor/quickjs/quickjs.c,6009,free_zero_refcount)'),
  ),
  'QuickJS 引擎内部断言失败',
  'aborted assert → friendly',
)
assert.equal(
  formatFatalErrorMessage('table index is out of bounds'),
  'QuickJS WASM 表索引越界',
  'table oob → friendly',
)
assert.equal(
  formatFatalErrorMessage('null function or function signature mismatch'),
  'QuickJS WASM 函数签名不匹配',
  'signature mismatch → friendly',
)
assert.ok(
  formatFatalErrorMessage(new QuickJsRuntimeFatalError('something broken')).startsWith(
    'QuickJS 致命错误: something broken',
  ),
  'typed fatal without known pattern → raw',
)
assert.equal(
  formatFatalErrorMessage(undefined),
  'QuickJS 致命错误: undefined',
  'undefined → raw',
)
assert.equal(
  formatFatalErrorMessage(''),
  '未知 QuickJS 致命错误',
  'empty string → unknown',
)
assert.equal(
  formatFatalErrorMessage('some random error'),
  'QuickJS 致命错误: some random error',
  'unknown pattern → raw',
)

console.log('quickjs-runtime-fatal: ok')
