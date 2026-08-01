import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const QUERYSTRING_BUNDLE_GLOBAL_KEY = '__instantQuerystringBundle'

/** Default / hard maxKeys for parse (abuse guard). */
const DEFAULT_MAX_KEYS = 1000

/**
 * 薄 querystring：parse / stringify / encode / decode / escape / unescape。
 * 对齐 Node 常用形状；不做完整 qs 库语义。
 */
const QUICKJS_QUERYSTRING_GUEST_SOURCE = `(function () {
  'use strict';

  var DEFAULT_MAX_KEYS = ${DEFAULT_MAX_KEYS};

  function unescape(str) {
    try {
      return decodeURIComponent(String(str).replace(/\\+/g, ' '));
    } catch (e) {
      return String(str).replace(/\\+/g, ' ');
    }
  }

  function escape(str) {
    return encodeURIComponent(String(str))
      .replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
      });
  }

  function parse(str, sep, eq, options) {
    sep = sep === undefined ? '&' : String(sep);
    eq = eq === undefined ? '=' : String(eq);
    var maxKeys = DEFAULT_MAX_KEYS;
    if (options && typeof options === 'object' && typeof options.maxKeys === 'number') {
      maxKeys = options.maxKeys < 0 ? Infinity : options.maxKeys;
    }
    var out = Object.create(null);
    if (str === undefined || str === null || str === '') {
      return out;
    }
    var s = String(str);
    if (s.charAt(0) === '?') {
      s = s.slice(1);
    }
    var pairs = s.split(sep);
    var count = 0;
    for (var i = 0; i < pairs.length; i++) {
      if (count >= maxKeys) {
        break;
      }
      var pair = pairs[i];
      if (pair === '') {
        continue;
      }
      var idx = pair.indexOf(eq);
      var key;
      var val;
      if (idx < 0) {
        key = unescape(pair);
        val = '';
      } else {
        key = unescape(pair.slice(0, idx));
        val = unescape(pair.slice(idx + eq.length));
      }
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        var existing = out[key];
        if (Array.isArray(existing)) {
          existing.push(val);
        } else {
          out[key] = [existing, val];
        }
      } else {
        out[key] = val;
        count += 1;
      }
    }
    return out;
  }

  function stringify(obj, sep, eq) {
    sep = sep === undefined ? '&' : String(sep);
    eq = eq === undefined ? '=' : String(eq);
    if (obj === undefined || obj === null || typeof obj !== 'object') {
      return '';
    }
    var keys = Object.keys(obj);
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var value = obj[key];
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (var j = 0; j < value.length; j++) {
          var item = value[j];
          if (item === undefined) {
            continue;
          }
          parts.push(escape(key) + eq + escape(item === null ? '' : String(item)));
        }
      } else {
        parts.push(escape(key) + eq + escape(value === null ? '' : String(value)));
      }
    }
    return parts.join(sep);
  }

  var qs = {
    parse: parse,
    stringify: stringify,
    decode: parse,
    encode: stringify,
    unescape: unescape,
    escape: escape,
  };

  globalThis.${QUERYSTRING_BUNDLE_GLOBAL_KEY} = qs;
})();
`

export function injectQuerystring(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(
    QUICKJS_QUERYSTRING_GUEST_SOURCE,
    'instant-querystring.js',
  )
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'querystring guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject querystring: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, QUERYSTRING_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject querystring: module object missing')
  }

  context.setProp(context.global, QUERYSTRING_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

const QUERYSTRING_EXPORT_KEYS = [
  'parse',
  'stringify',
  'decode',
  'encode',
  'unescape',
  'escape',
] as const

export function buildQuerystringModuleSource(builtinsGlobalKey: string): string {
  const named = QUERYSTRING_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join(
    '\n',
  )
  return (
    `const __m = globalThis.${builtinsGlobalKey}.querystring;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
