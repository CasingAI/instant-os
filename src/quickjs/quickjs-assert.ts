import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const ASSERT_BUNDLE_GLOBAL_KEY = '__instantAssertBundle'

/**
 * L2.5.1 薄 assert：手写 guest 源（不 vendor npm assert）。
 * CJS：`require('assert')` 为可调用函数，并挂 ok/equal/strictEqual 等。
 * ESM：default + 常用具名导出（含 yargs 用的 strictEqual / notStrictEqual）。
 */
const QUICKJS_ASSERT_GUEST_SOURCE = `(function () {
  'use strict';

  function AssertionError(options) {
    if (!(this instanceof AssertionError)) {
      return new AssertionError(options);
    }
    var opts = options && typeof options === 'object' ? options : {};
    var message = opts.message;
    if (message === undefined || message === null || message === '') {
      message = 'Assertion failed';
      if (opts.operator !== undefined) {
        message =
          truncate(inspectValue(opts.actual)) +
          ' ' +
          String(opts.operator) +
          ' ' +
          truncate(inspectValue(opts.expected));
      }
    } else if (typeof message !== 'string') {
      message = String(message);
    }
    Error.call(this, message);
    this.name = 'AssertionError';
    this.message = message;
    this.actual = opts.actual;
    this.expected = opts.expected;
    this.operator = opts.operator;
    this.generatedMessage = !opts.message;
    this.code = 'ERR_ASSERTION';
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, opts.stackStartFn || AssertionError);
    }
  }

  AssertionError.prototype = Object.create(Error.prototype);
  AssertionError.prototype.constructor = AssertionError;
  AssertionError.prototype.toString = function toString() {
    return this.name + ' [' + this.code + ']: ' + this.message;
  };

  function truncate(text) {
    var s = String(text);
    if (s.length <= 128) {
      return s;
    }
    return s.slice(0, 125) + '...';
  }

  function inspectValue(value) {
    if (typeof value === 'string') {
      return JSON.stringify(value);
    }
    if (typeof value === 'undefined') {
      return 'undefined';
    }
    if (typeof value === 'function') {
      return '[Function' + (value.name ? ': ' + value.name : '') + ']';
    }
    try {
      return JSON.stringify(value);
    } catch (_err) {
      return Object.prototype.toString.call(value);
    }
  }

  function fail(actual, expected, message, operator, stackStartFn) {
    if (
      arguments.length === 1 ||
      (arguments.length === 2 &&
        expected === undefined &&
        typeof actual === 'object' &&
        actual !== null &&
        ('message' in actual || 'actual' in actual))
    ) {
      var single = actual && typeof actual === 'object' ? actual : { message: actual };
      throw new AssertionError({
        message: single.message,
        actual: single.actual,
        expected: single.expected,
        operator: single.operator,
        stackStartFn: single.stackStartFn || fail,
      });
    }
    throw new AssertionError({
      message: message,
      actual: actual,
      expected: expected,
      operator: operator === undefined ? 'fail' : operator,
      stackStartFn: stackStartFn || fail,
    });
  }

  function innerFail(obj) {
    throw new AssertionError(obj);
  }

  function ok(value, message) {
    if (!value) {
      innerFail({
        actual: value,
        expected: true,
        message: message,
        operator: '==',
        stackStartFn: ok,
      });
    }
  }

  function equal(actual, expected, message) {
    if (actual != expected) {
      innerFail({
        actual: actual,
        expected: expected,
        message: message,
        operator: '==',
        stackStartFn: equal,
      });
    }
  }

  function notEqual(actual, expected, message) {
    if (actual == expected) {
      innerFail({
        actual: actual,
        expected: expected,
        message: message,
        operator: '!=',
        stackStartFn: notEqual,
      });
    }
  }

  function strictEqual(actual, expected, message) {
    if (!Object.is(actual, expected)) {
      innerFail({
        actual: actual,
        expected: expected,
        message: message,
        operator: 'strictEqual',
        stackStartFn: strictEqual,
      });
    }
  }

  function notStrictEqual(actual, expected, message) {
    if (Object.is(actual, expected)) {
      innerFail({
        actual: actual,
        expected: expected,
        message: message,
        operator: 'notStrictEqual',
        stackStartFn: notStrictEqual,
      });
    }
  }

  function isDeepEqual(actual, expected, strict) {
    if (Object.is(actual, expected)) {
      return true;
    }
    if (
      typeof actual !== 'object' ||
      actual === null ||
      typeof expected !== 'object' ||
      expected === null
    ) {
      return false;
    }
    if (actual instanceof Date && expected instanceof Date) {
      return actual.getTime() === expected.getTime();
    }
    if (actual instanceof RegExp && expected instanceof RegExp) {
      return String(actual) === String(expected);
    }
    if (Array.isArray(actual) !== Array.isArray(expected)) {
      return false;
    }
    if (Array.isArray(actual)) {
      if (actual.length !== expected.length) {
        return false;
      }
      for (var i = 0; i < actual.length; i++) {
        if (!isDeepEqual(actual[i], expected[i], strict)) {
          return false;
        }
      }
      return true;
    }
    var actualKeys = Object.keys(actual);
    var expectedKeys = Object.keys(expected);
    if (actualKeys.length !== expectedKeys.length) {
      return false;
    }
    actualKeys.sort();
    expectedKeys.sort();
    for (var k = 0; k < actualKeys.length; k++) {
      if (actualKeys[k] !== expectedKeys[k]) {
        return false;
      }
    }
    for (var j = 0; j < actualKeys.length; j++) {
      var key = actualKeys[j];
      if (!isDeepEqual(actual[key], expected[key], strict)) {
        return false;
      }
    }
    if (strict) {
      return Object.getPrototypeOf(actual) === Object.getPrototypeOf(expected);
    }
    return true;
  }

  function deepEqual(actual, expected, message) {
    if (!isDeepEqual(actual, expected, false)) {
      innerFail({
        actual: actual,
        expected: expected,
        message: message,
        operator: 'deepEqual',
        stackStartFn: deepEqual,
      });
    }
  }

  function notDeepEqual(actual, expected, message) {
    if (isDeepEqual(actual, expected, false)) {
      innerFail({
        actual: actual,
        expected: expected,
        message: message,
        operator: 'notDeepEqual',
        stackStartFn: notDeepEqual,
      });
    }
  }

  function deepStrictEqual(actual, expected, message) {
    if (!isDeepEqual(actual, expected, true)) {
      innerFail({
        actual: actual,
        expected: expected,
        message: message,
        operator: 'deepStrictEqual',
        stackStartFn: deepStrictEqual,
      });
    }
  }

  function notDeepStrictEqual(actual, expected, message) {
    if (isDeepEqual(actual, expected, true)) {
      innerFail({
        actual: actual,
        expected: expected,
        message: message,
        operator: 'notDeepStrictEqual',
        stackStartFn: notDeepStrictEqual,
      });
    }
  }

  function expectedException(actual, expected) {
    if (typeof expected === 'string') {
      return actual && String(actual.message || actual).indexOf(expected) !== -1;
    }
    if (typeof expected === 'function') {
      if (expected.prototype !== undefined && actual instanceof expected) {
        return true;
      }
      if (Error.isPrototypeOf(expected)) {
        return false;
      }
      return expected.call({}, actual) === true;
    }
    if (expected && typeof expected === 'object' && expected instanceof RegExp) {
      return expected.test(
        String(actual && actual.message !== undefined ? actual.message : actual),
      );
    }
    return false;
  }

  function throws(fn, expected, message) {
    if (typeof fn !== 'function') {
      throw new TypeError('The "fn" argument must be of type function');
    }
    var error;
    var threw = false;
    try {
      fn();
    } catch (err) {
      threw = true;
      error = err;
    }
    if (!threw) {
      innerFail({
        message: message || 'Missing expected exception.',
        operator: 'throws',
        stackStartFn: throws,
      });
    }
    if (expected !== undefined && expected !== null && typeof expected !== 'string') {
      if (!expectedException(error, expected)) {
        throw error;
      }
    } else if (typeof expected === 'string') {
      if (!expectedException(error, expected)) {
        innerFail({
          actual: error,
          expected: expected,
          message: message,
          operator: 'throws',
          stackStartFn: throws,
        });
      }
    }
    return error;
  }

  function doesNotThrow(fn, expected, message) {
    if (typeof fn !== 'function') {
      throw new TypeError('The "fn" argument must be of type function');
    }
    try {
      fn();
    } catch (err) {
      if (expected !== undefined && expected !== null && expectedException(err, expected)) {
        innerFail({
          actual: err,
          expected: expected,
          message: message || 'Got unwanted exception.',
          operator: 'doesNotThrow',
          stackStartFn: doesNotThrow,
        });
      }
      throw err;
    }
  }

  function assert(value, message) {
    ok(value, message);
  }

  assert.AssertionError = AssertionError;
  assert.fail = fail;
  assert.ok = ok;
  assert.equal = equal;
  assert.notEqual = notEqual;
  assert.strictEqual = strictEqual;
  assert.notStrictEqual = notStrictEqual;
  assert.deepEqual = deepEqual;
  assert.notDeepEqual = notDeepEqual;
  assert.deepStrictEqual = deepStrictEqual;
  assert.notDeepStrictEqual = notDeepStrictEqual;
  assert.throws = throws;
  assert.doesNotThrow = doesNotThrow;
  assert.strict = assert;

  globalThis.${ASSERT_BUNDLE_GLOBAL_KEY} = assert;
})();
`

/**
 * Eval thin assert into guest；返回模块 handle（可调用函数）。
 */
export function injectAssert(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(QUICKJS_ASSERT_GUEST_SOURCE, 'instant-assert.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'assert guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject assert: ${message}`)
  }
  evalResult.value.dispose()

  const assertHandle = context.getProp(context.global, ASSERT_BUNDLE_GLOBAL_KEY)
  if (context.typeof(assertHandle) !== 'function') {
    assertHandle.dispose()
    throw new Error('Failed to inject assert: assert function missing')
  }

  context.setProp(context.global, ASSERT_BUNDLE_GLOBAL_KEY, context.undefined)
  return assertHandle
}

const ASSERT_EXPORT_KEYS = [
  'AssertionError',
  'fail',
  'ok',
  'equal',
  'notEqual',
  'strictEqual',
  'notStrictEqual',
  'deepEqual',
  'notDeepEqual',
  'deepStrictEqual',
  'notDeepStrictEqual',
  'throws',
  'doesNotThrow',
  'strict',
] as const

export function buildAssertModuleSource(builtinsGlobalKey: string): string {
  const named = ASSERT_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return (
    `const __m = globalThis.${builtinsGlobalKey}.assert;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
