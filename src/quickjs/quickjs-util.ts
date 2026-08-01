import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const UTIL_BUNDLE_GLOBAL_KEY = '__instantUtilBundle'

/**
 * L2.5.3 薄 util（第一刀）：手写 guest 源，覆盖 yargs/cowsay 加载期需要的 `inspect`，
 * 以及常见 CLI 探测面 `inherits` / `promisify` / `types` 最小子集。
 * 不做完整 Node util。
 */
const QUICKJS_UTIL_GUEST_SOURCE = `(function () {
  'use strict';

  function inspect(value, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var depth = typeof opts.depth === 'number' ? opts.depth : 2;
    var seen = [];

    function format(val, currentDepth) {
      if (typeof val === 'string') {
        return JSON.stringify(val);
      }
      if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
        return String(val);
      }
      if (typeof val === 'undefined') {
        return 'undefined';
      }
      if (val === null) {
        return 'null';
      }
      if (typeof val === 'symbol') {
        return String(val);
      }
      if (typeof val === 'function') {
        return '[Function' + (val.name ? ': ' + val.name : '') + ']';
      }
      if (val instanceof Error) {
        return val.stack || val.name + ': ' + val.message;
      }
      if (val instanceof Date) {
        return val.toISOString();
      }
      if (val instanceof RegExp) {
        return String(val);
      }
      if (seen.indexOf(val) !== -1) {
        return '[Circular]';
      }
      if (currentDepth < 0) {
        if (Array.isArray(val)) {
          return '[Array]';
        }
        return '[Object]';
      }
      seen.push(val);
      try {
        if (Array.isArray(val)) {
          var items = [];
          for (var i = 0; i < val.length; i++) {
            items.push(format(val[i], currentDepth - 1));
          }
          return '[ ' + items.join(', ') + ' ]';
        }
        var keys = Object.keys(val);
        var parts = [];
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          parts.push(key + ': ' + format(val[key], currentDepth - 1));
        }
        return '{ ' + parts.join(', ') + ' }';
      } finally {
        seen.pop();
      }
    }

    return format(value, depth);
  }

  function inherits(ctor, superCtor) {
    if (ctor === undefined || ctor === null) {
      throw new TypeError('The constructor to inherit from must be a function');
    }
    if (superCtor === undefined || superCtor === null) {
      throw new TypeError('The super constructor to inherit from must be a function');
    }
    ctor.super_ = superCtor;
    Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  }

  function promisify(original) {
    if (typeof original !== 'function') {
      throw new TypeError('The "original" argument must be of type function');
    }
    function fn() {
      var args = Array.prototype.slice.call(arguments);
      return new Promise(function (resolve, reject) {
        args.push(function (err, value) {
          if (err) {
            reject(err);
            return;
          }
          resolve(value);
        });
        try {
          original.apply(this, args);
        } catch (error) {
          reject(error);
        }
      });
    }
    Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
    return fn;
  }

  var types = {
    isDate: function isDate(value) {
      return value instanceof Date;
    },
    isRegExp: function isRegExp(value) {
      return value instanceof RegExp;
    },
    isArrayBuffer: function isArrayBuffer(value) {
      return value instanceof ArrayBuffer;
    },
    isTypedArray: function isTypedArray(value) {
      return ArrayBuffer.isView(value) && !(value instanceof DataView);
    },
    isPromise: function isPromise(value) {
      return (
        value !== null &&
        typeof value === 'object' &&
        typeof value.then === 'function'
      );
    },
  };

  function format(fmt) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (typeof fmt !== 'string') {
      var parts = [inspect(fmt)];
      for (var a = 0; a < args.length; a++) {
        parts.push(inspect(args[a]));
      }
      return parts.join(' ');
    }
    var i = 0;
    var out = fmt.replace(/%[sdj%]/g, function (match) {
      if (match === '%%') {
        return '%';
      }
      if (i >= args.length) {
        return match;
      }
      var arg = args[i++];
      if (match === '%s') {
        return String(arg);
      }
      if (match === '%d') {
        return String(Number(arg));
      }
      if (match === '%j') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return '[Circular]';
        }
      }
      return match;
    });
    for (; i < args.length; i++) {
      out += ' ' + inspect(args[i]);
    }
    return out;
  }

  function deprecate(fn, msg) {
    if (typeof fn !== 'function') {
      throw new TypeError('The "fn" argument must be of type function');
    }
    var warned = false;
    function deprecated() {
      if (!warned) {
        warned = true;
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn(msg == null ? 'Deprecated' : String(msg));
        }
      }
      return fn.apply(this, arguments);
    }
    return deprecated;
  }

  function debuglog(section) {
    var name = String(section == null ? '' : section);
    var env =
      typeof process !== 'undefined' && process && process.env ? process.env.NODE_DEBUG : undefined;
    var enabled =
      typeof env === 'string' &&
      env.length > 0 &&
      env.split(/[\\s,]+/).some(function (part) {
        return part && (part === '*' || part.toLowerCase() === name.toLowerCase());
      });
    if (!enabled) {
      return function noopDebug() {};
    }
    return function debug() {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(name);
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error.apply(console, args);
      }
    };
  }

  var util = {
    inspect: inspect,
    inherits: inherits,
    promisify: promisify,
    types: types,
    format: format,
    deprecate: deprecate,
    debuglog: debuglog,
  };

  globalThis.${UTIL_BUNDLE_GLOBAL_KEY} = util;
})();
`

/**
 * Eval thin util into guest；返回模块对象 handle。
 */
export function injectUtil(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(QUICKJS_UTIL_GUEST_SOURCE, 'instant-util.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'util guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject util: ${message}`)
  }
  evalResult.value.dispose()

  const utilHandle = context.getProp(context.global, UTIL_BUNDLE_GLOBAL_KEY)
  if (context.typeof(utilHandle) !== 'object') {
    utilHandle.dispose()
    throw new Error('Failed to inject util: util object missing')
  }

  context.setProp(context.global, UTIL_BUNDLE_GLOBAL_KEY, context.undefined)
  return utilHandle
}

const UTIL_EXPORT_KEYS = [
  'inspect',
  'inherits',
  'promisify',
  'types',
  'format',
  'deprecate',
  'debuglog',
] as const

export function buildUtilModuleSource(builtinsGlobalKey: string): string {
  const named = UTIL_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return (
    `const __m = globalThis.${builtinsGlobalKey}.util;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
