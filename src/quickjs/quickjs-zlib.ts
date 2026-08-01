import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'
import {
  deflateSync,
  gzipSync,
  gunzipSync,
  inflateSync,
  unzlibSync,
  zlibSync,
  type DeflateOptions,
  type GzipOptions,
} from 'fflate'

const ZLIB_BUNDLE_GLOBAL_KEY = '__instantZlibBundle'
const HOST_ZLIB_SYNC_KEY = '__instantZlibSync'
const ZLIB_TRANSFORM_GLOBAL_KEY = '__instantZlibTransform'
const TMP_AB_KEY = '__instantTmpArrayBuffer'

const ZLIB_OPS = new Set([
  'gzip',
  'gunzip',
  'deflate',
  'inflate',
  'deflateRaw',
  'inflateRaw',
  'unzip',
])

function copyHostBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function readGuestBytes(context: QuickJSContext, handle: QuickJSHandle): Uint8Array {
  try {
    const lifetime = context.getArrayBuffer(handle)
    try {
      return new Uint8Array(lifetime.value)
    } finally {
      lifetime.dispose()
    }
  } catch {
    // Buffer / TypedArray
  }

  let bufferHandle: QuickJSHandle | undefined
  let offsetHandle: QuickJSHandle | undefined
  let lengthHandle: QuickJSHandle | undefined
  try {
    bufferHandle = context.getProp(handle, 'buffer')
    if (context.typeof(bufferHandle) === 'undefined') {
      throw new TypeError(
        'The "buffer" argument must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer',
      )
    }
    offsetHandle = context.getProp(handle, 'byteOffset')
    lengthHandle = context.getProp(handle, 'byteLength')
    const offset = context.typeof(offsetHandle) === 'number' ? context.getNumber(offsetHandle) : 0
    const length =
      context.typeof(lengthHandle) === 'number' ? context.getNumber(lengthHandle) : undefined
    const lifetime = context.getArrayBuffer(bufferHandle)
    try {
      const view = lifetime.value
      if (length === undefined) {
        return new Uint8Array(view.subarray(offset))
      }
      return new Uint8Array(view.subarray(offset, offset + length))
    } finally {
      lifetime.dispose()
    }
  } finally {
    lengthHandle?.dispose()
    offsetHandle?.dispose()
    bufferHandle?.dispose()
  }
}

function isAbsentHandle(context: QuickJSContext, handle: QuickJSHandle): boolean {
  return context.typeof(handle) === 'undefined' || context.typeof(handle) === 'null'
}

function parseCompressOptions(
  context: QuickJSContext,
  optionsHandle: QuickJSHandle,
): GzipOptions | DeflateOptions | undefined {
  if (isAbsentHandle(context, optionsHandle) || context.typeof(optionsHandle) !== 'object') {
    return undefined
  }
  try {
    const opts = context.dump(optionsHandle) as { level?: number }
    if (opts && typeof opts.level === 'number' && Number.isFinite(opts.level)) {
      return { level: opts.level }
    }
  } catch {
    // ignore
  }
  return undefined
}

function hostZlibSync(op: string, input: Uint8Array, options?: GzipOptions | DeflateOptions): Uint8Array {
  switch (op) {
    case 'gzip':
      return gzipSync(input, options as GzipOptions)
    case 'gunzip':
      return gunzipSync(input)
    case 'deflate':
      return zlibSync(input, options as DeflateOptions)
    case 'inflate':
      return unzlibSync(input)
    case 'deflateRaw':
      return deflateSync(input, options as DeflateOptions)
    case 'inflateRaw':
      return inflateSync(input)
    case 'unzip':
      try {
        return gunzipSync(input)
      } catch {
        return unzlibSync(input)
      }
    default:
      throw new Error(`Instant zlib: unknown op ${op}`)
  }
}

function hostBytesToGuestBuffer(context: QuickJSContext, bytes: Uint8Array): QuickJSHandle {
  const abHandle = context.newArrayBuffer(copyHostBytes(bytes))
  context.setProp(context.global, TMP_AB_KEY, abHandle)
  abHandle.dispose()
  try {
    return context.unwrapResult(
      context.evalCode(`Buffer.from(globalThis.${TMP_AB_KEY})`, 'instant-zlib-buffer-wrap.js'),
    )
  } finally {
    context.setProp(context.global, TMP_AB_KEY, context.undefined)
  }
}

function installHostBridges(context: QuickJSContext): () => void {
  const syncFn = context.newFunction(
    HOST_ZLIB_SYNC_KEY,
    (opHandle, inputHandle, optionsHandle) => {
      const op = (() => {
        try {
          return String(context.dump(opHandle))
        } catch {
          return context.getString(opHandle)
        }
      })()
      if (!ZLIB_OPS.has(op)) {
        throw new Error(`Instant zlib: invalid op '${op}'`)
      }
      const input = readGuestBytes(context, inputHandle)
      const options = parseCompressOptions(context, optionsHandle)
      try {
        const out = hostZlibSync(op, input, options)
        return hostBytesToGuestBuffer(context, out)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const err = new Error(message)
        const code =
          op === 'gunzip' || op === 'inflate' || op === 'inflateRaw' || op === 'unzip'
            ? 'Z_DATA_ERROR'
            : 'ERR_BUFFER_OUT_OF_BOUNDS'
        ;(err as Error & { code?: string }).code = code
        throw err
      }
    },
  )
  context.setProp(context.global, HOST_ZLIB_SYNC_KEY, syncFn)
  syncFn.dispose()

  return () => {
    context.setProp(context.global, HOST_ZLIB_SYNC_KEY, context.undefined)
  }
}

const QUICKJS_ZLIB_GUEST_SOURCE = `(function () {
  'use strict';

  var Transform = globalThis.${ZLIB_TRANSFORM_GLOBAL_KEY};

  function normalizeInput(buffer) {
    if (buffer == null) {
      return Buffer.alloc(0);
    }
    if (typeof buffer === 'string') {
      return Buffer.from(buffer);
    }
    return buffer;
  }

  function zlibSync(op, buffer, options) {
    return globalThis.${HOST_ZLIB_SYNC_KEY}(op, normalizeInput(buffer), options);
  }

  function makeSyncPair(op) {
    return {
      sync: function syncFn(buffer, options) {
        return zlibSync(op, buffer, options);
      },
      async: function asyncFn(buffer, options, callback) {
        if (typeof options === 'function') {
          callback = options;
          options = undefined;
        }
        try {
          var out = zlibSync(op, buffer, options);
          if (typeof callback === 'function') {
            globalThis.setTimeout(function () {
              callback(null, out);
            }, 0);
          }
        } catch (err) {
          if (typeof callback === 'function') {
            globalThis.setTimeout(function () {
              callback(err);
            }, 0);
          } else {
            throw err;
          }
        }
      },
    };
  }

  var gzipPair = makeSyncPair('gzip');
  var gunzipPair = makeSyncPair('gunzip');
  var deflatePair = makeSyncPair('deflate');
  var inflatePair = makeSyncPair('inflate');
  var deflateRawPair = makeSyncPair('deflateRaw');
  var inflateRawPair = makeSyncPair('inflateRaw');
  var unzipPair = makeSyncPair('unzip');

  function createTransform(op, options) {
    var chunks = [];
    return new Transform({
      transform: function transform(chunk, encoding, callback) {
        if (chunk != null && chunk.length !== 0) {
          chunks.push(chunk);
        }
        callback();
      },
      flush: function flush(callback) {
        var self = this;
        try {
          var buf = chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
          var out = zlibSync(op, buf, options);
          self.push(out);
          callback();
        } catch (err) {
          callback(err);
        }
      },
    });
  }

  function createGunzipTransform(op, options) {
    var chunks = [];
    return new Transform({
      transform: function transform(chunk, encoding, callback) {
        if (chunk != null && chunk.length !== 0) {
          chunks.push(chunk);
        }
        callback();
      },
      flush: function flush(callback) {
        var self = this;
        try {
          var buf = chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
          var out = zlibSync(op, buf, options);
          self.push(out);
          callback();
        } catch (err) {
          callback(err);
        }
      },
    });
  }

  var constants = {
    Z_NO_FLUSH: 0,
    Z_PARTIAL_FLUSH: 1,
    Z_SYNC_FLUSH: 2,
    Z_FULL_FLUSH: 3,
    Z_FINISH: 4,
    Z_BLOCK: 5,
    Z_OK: 0,
    Z_STREAM_END: 1,
    Z_NEED_DICT: 2,
    Z_ERRNO: -1,
    Z_STREAM_ERROR: -2,
    Z_DATA_ERROR: -3,
    Z_MEM_ERROR: -4,
    Z_BUF_ERROR: -5,
    Z_VERSION_ERROR: -6,
  };

  globalThis.${ZLIB_BUNDLE_GLOBAL_KEY} = {
    gzip: gzipPair.async,
    gzipSync: gzipPair.sync,
    gunzip: gunzipPair.async,
    gunzipSync: gunzipPair.sync,
    deflate: deflatePair.async,
    deflateSync: deflatePair.sync,
    inflate: inflatePair.async,
    inflateSync: inflatePair.sync,
    deflateRaw: deflateRawPair.async,
    deflateRawSync: deflateRawPair.sync,
    inflateRaw: inflateRawPair.async,
    inflateRawSync: inflateRawPair.sync,
    unzip: unzipPair.async,
    unzipSync: unzipPair.sync,
    createGzip: function createGzip(options) {
      return createTransform('gzip', options);
    },
    createGunzip: function createGunzip(options) {
      return createGunzipTransform('gunzip', options);
    },
    createDeflate: function createDeflate(options) {
      return createTransform('deflate', options);
    },
    createInflate: function createInflate(options) {
      return createGunzipTransform('inflate', options);
    },
    createDeflateRaw: function createDeflateRaw(options) {
      return createTransform('deflateRaw', options);
    },
    createInflateRaw: function createInflateRaw(options) {
      return createGunzipTransform('inflateRaw', options);
    },
    createUnzip: function createUnzip(options) {
      return createGunzipTransform('unzip', options);
    },
    constants: constants,
  };
})();
`

export type InjectZlibResult = {
  handle: QuickJSHandle
  dispose: () => void
}

export function injectZlib(
  context: QuickJSContext,
  streamHandle: QuickJSHandle,
): InjectZlibResult {
  const transformHandle = context.getProp(streamHandle, 'Transform')
  context.setProp(context.global, ZLIB_TRANSFORM_GLOBAL_KEY, transformHandle)
  transformHandle.dispose()

  const disposeBridges = installHostBridges(context)

  const evalResult = context.evalCode(QUICKJS_ZLIB_GUEST_SOURCE, 'instant-zlib.js')
  context.setProp(context.global, ZLIB_TRANSFORM_GLOBAL_KEY, context.undefined)

  if (evalResult.error) {
    disposeBridges()
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'zlib guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject zlib: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, ZLIB_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    disposeBridges()
    handle.dispose()
    throw new Error('Failed to inject zlib: module object missing')
  }

  context.setProp(context.global, ZLIB_BUNDLE_GLOBAL_KEY, context.undefined)
  return { handle, dispose: disposeBridges }
}

const ZLIB_EXPORT_KEYS = [
  'gzip',
  'gzipSync',
  'gunzip',
  'gunzipSync',
  'deflate',
  'deflateSync',
  'inflate',
  'inflateSync',
  'deflateRaw',
  'deflateRawSync',
  'inflateRaw',
  'inflateRawSync',
  'unzip',
  'unzipSync',
  'createGzip',
  'createGunzip',
  'createDeflate',
  'createInflate',
  'createDeflateRaw',
  'createInflateRaw',
  'createUnzip',
  'constants',
] as const

export function buildZlibModuleSource(builtinsGlobalKey: string): string {
  const named = ZLIB_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return `const __m = globalThis.${builtinsGlobalKey}.zlib;\n${named}\nexport default __m;\n`
}
