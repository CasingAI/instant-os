import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

const STRING_DECODER_BUNDLE_GLOBAL_KEY = '__instantStringDecoderBundle'

/**
 * 薄 `string_decoder`：仅 UTF-8；不完整多字节序列按 Buffer.toString 行为处理。
 */
const QUICKJS_STRING_DECODER_GUEST_SOURCE = `(function () {
  'use strict';

  function normalizeEncoding(encoding) {
    if (encoding === undefined || encoding === null || encoding === '') {
      return 'utf8';
    }
    var n = String(encoding).trim().toLowerCase().replace(/_/g, '-');
    if (n === 'utf8' || n === 'utf-8') {
      return 'utf8';
    }
    throw new RangeError(
      "The encoding label provided ('" + encoding + "') is invalid or unsupported. Instant string_decoder only supports utf8.",
    );
  }

  function StringDecoder(encoding, options) {
    this.encoding = normalizeEncoding(encoding);
    this.fatal = !!(options && options.fatal);
    this.ignoreBOM = !!(options && options.ignoreBOM);
    this._leftover = '';
  }

  StringDecoder.prototype.write = function write(buffer) {
    if (buffer == null || buffer === '') {
      return '';
    }
    if (typeof buffer === 'string') {
      return buffer;
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)) {
      return buffer.toString('utf8');
    }
    if (buffer instanceof Uint8Array) {
      return Buffer.from(buffer).toString('utf8');
    }
    return String(buffer);
  };

  StringDecoder.prototype.end = function end(buffer) {
    var rest = buffer ? this.write(buffer) : '';
    var out = this._leftover + rest;
    this._leftover = '';
    return out;
  };

  StringDecoder.prototype.reset = function reset() {
    this._leftover = '';
  };

  globalThis.${STRING_DECODER_BUNDLE_GLOBAL_KEY} = {
    StringDecoder: StringDecoder,
  };
})();
`

export function injectStringDecoder(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(
    QUICKJS_STRING_DECODER_GUEST_SOURCE,
    'instant-string-decoder.js',
  )
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'string_decoder guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject string_decoder: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, STRING_DECODER_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject string_decoder: module object missing')
  }

  context.setProp(context.global, STRING_DECODER_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

const STRING_DECODER_EXPORT_KEYS = ['StringDecoder'] as const

export function buildStringDecoderModuleSource(builtinsGlobalKey: string): string {
  const named = STRING_DECODER_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join(
    '\n',
  )
  return (
    `const __m = globalThis.${builtinsGlobalKey}.string_decoder;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
