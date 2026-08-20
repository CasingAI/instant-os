import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'
import {
  Deflate,
  Gzip,
  Gunzip,
  Inflate,
  Unzlib,
  Zlib,
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
const HOST_ZLIB_STREAM_CREATE_KEY = '__instantZlibStreamCreate'
const HOST_ZLIB_STREAM_PUSH_KEY = '__instantZlibStreamPush'
const HOST_ZLIB_STREAM_END_KEY = '__instantZlibStreamEnd'
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

type FlateStream = {
  push: (data: Uint8Array, final?: boolean) => void
}

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
      return { level: opts.level as GzipOptions['level'] }
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

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0)
  if (chunks.length === 1) return chunks[0]!
  let total = 0
  for (const c of chunks) total += c.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

function createFlateStream(
  op: string,
  options: GzipOptions | DeflateOptions | undefined,
  onData: (chunk: Uint8Array) => void,
): FlateStream {
  const handler = (chunk: Uint8Array, _final?: boolean) => {
    if (chunk && chunk.byteLength > 0) onData(chunk)
  }
  switch (op) {
    case 'gzip':
      return new Gzip(options as GzipOptions, handler)
    case 'gunzip':
    case 'unzip':
      return new Gunzip(handler)
    case 'deflate':
      return new Zlib(options as DeflateOptions, handler)
    case 'inflate':
      return new Unzlib(handler)
    case 'deflateRaw':
      return new Deflate(options as DeflateOptions, handler)
    case 'inflateRaw':
      return new Inflate(handler)
    default:
      throw new Error(`Instant zlib: unknown stream op ${op}`)
  }
}

function installHostBridges(context: QuickJSContext): () => void {
  let nextId = 1
  const streams = new Map<number, { stream: FlateStream; pending: Uint8Array[] }>()

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

  const createFn = context.newFunction(
    HOST_ZLIB_STREAM_CREATE_KEY,
    (opHandle, optionsHandle) => {
      const op = String(context.dump(opHandle))
      if (!ZLIB_OPS.has(op)) {
        throw new Error(`Instant zlib: invalid stream op '${op}'`)
      }
      const options = parseCompressOptions(context, optionsHandle)
      const id = nextId++
      const pending: Uint8Array[] = []
      const stream = createFlateStream(op, options, (chunk) => {
        pending.push(chunk)
      })
      streams.set(id, { stream, pending })
      return context.newNumber(id)
    },
  )
  context.setProp(context.global, HOST_ZLIB_STREAM_CREATE_KEY, createFn)
  createFn.dispose()

  const pushFn = context.newFunction(
    HOST_ZLIB_STREAM_PUSH_KEY,
    (idHandle, dataHandle) => {
      const id = context.getNumber(idHandle)
      const entry = streams.get(id)
      if (!entry) {
        throw new Error('zlib stream closed')
      }
      const input = readGuestBytes(context, dataHandle)
      entry.stream.push(input, false)
      const out = concatChunks(entry.pending)
      entry.pending.length = 0
      if (out.byteLength === 0) {
        return context.null
      }
      return hostBytesToGuestBuffer(context, out)
    },
  )
  context.setProp(context.global, HOST_ZLIB_STREAM_PUSH_KEY, pushFn)
  pushFn.dispose()

  const endFn = context.newFunction(HOST_ZLIB_STREAM_END_KEY, (idHandle) => {
    const id = context.getNumber(idHandle)
    const entry = streams.get(id)
    if (!entry) {
      return context.null
    }
    entry.stream.push(new Uint8Array(0), true)
    const out = concatChunks(entry.pending)
    streams.delete(id)
    if (out.byteLength === 0) {
      return context.null
    }
    return hostBytesToGuestBuffer(context, out)
  })
  context.setProp(context.global, HOST_ZLIB_STREAM_END_KEY, endFn)
  endFn.dispose()

  return () => {
    streams.clear()
    context.setProp(context.global, HOST_ZLIB_SYNC_KEY, context.undefined)
    context.setProp(context.global, HOST_ZLIB_STREAM_CREATE_KEY, context.undefined)
    context.setProp(context.global, HOST_ZLIB_STREAM_PUSH_KEY, context.undefined)
    context.setProp(context.global, HOST_ZLIB_STREAM_END_KEY, context.undefined)
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

  function createStreamingTransform(op, options) {
    var sid = globalThis.${HOST_ZLIB_STREAM_CREATE_KEY}(op, options);
    return new Transform({
      transform: function transform(chunk, encoding, callback) {
        try {
          if (chunk == null || chunk.length === 0) {
            callback();
            return;
          }
          var buf = typeof chunk === 'string' ? Buffer.from(chunk, encoding || 'utf8') : chunk;
          var out = globalThis.${HOST_ZLIB_STREAM_PUSH_KEY}(sid, buf);
          if (out != null) {
            this.push(out);
          }
          callback();
        } catch (err) {
          callback(err);
        }
      },
      flush: function flush(callback) {
        try {
          var out = globalThis.${HOST_ZLIB_STREAM_END_KEY}(sid);
          if (out != null) {
            this.push(out);
          }
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
      return createStreamingTransform('gzip', options);
    },
    createGunzip: function createGunzip(options) {
      return createStreamingTransform('gunzip', options);
    },
    createDeflate: function createDeflate(options) {
      return createStreamingTransform('deflate', options);
    },
    createInflate: function createInflate(options) {
      return createStreamingTransform('inflate', options);
    },
    createDeflateRaw: function createDeflateRaw(options) {
      return createStreamingTransform('deflateRaw', options);
    },
    createInflateRaw: function createInflateRaw(options) {
      return createStreamingTransform('inflateRaw', options);
    },
    createUnzip: function createUnzip(options) {
      return createStreamingTransform('unzip', options);
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
