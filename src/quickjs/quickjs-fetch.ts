import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten'
import {
  proxiedFetch,
  ProxyServerApiError,
  PROXY_SERVER_NOT_CONFIGURED_MESSAGE,
} from '../os/proxy-server-api.ts'
import { isProxyServerConnected } from '../os/proxy-server-settings-storage.ts'
import type { QuickJsAsyncBridge } from './quickjs-async-bridge.ts'
import { dispatchSyscallIfExists, type QuickJsSyscallChain } from './quickjs-syscall.ts'

const HOST_FETCH_KEY = '__instantHostFetch'
const HOST_FETCH_STREAM_READ_KEY = '__instantFetchStreamRead'
const HOST_FETCH_STREAM_CANCEL_KEY = '__instantFetchStreamCancel'
const TMP_AB_KEY = '__instantTmpArrayBuffer'

function copyHostBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/**
 * 与 WebView / Chromo 一致：已连接代理时走 Worker relay（绕 CORS、计入代理指标）。
 * Node 冒烟等无代理环境：仅在未连接时回退直连 fetch，便于 CI。
 */
async function hostFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isProxyServerConnected()) {
    return proxiedFetch(url, init)
  }
  const direct = globalThis.fetch
  if (typeof direct === 'function') {
    return direct(url, init)
  }
  throw new ProxyServerApiError(PROXY_SERVER_NOT_CONFIGURED_MESSAGE)
}

function readGuestBytes(context: QuickJSAsyncContext, handle: QuickJSHandle): Uint8Array<ArrayBuffer> {
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
        'The "body" argument must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer',
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

function dumpArgString(context: QuickJSAsyncContext, handle: QuickJSHandle): string {
  try {
    const dumped = context.dump(handle)
    if (typeof dumped === 'string') {
      return dumped
    }
    if (
      dumped === undefined ||
      dumped === null ||
      typeof dumped === 'number' ||
      typeof dumped === 'boolean' ||
      typeof dumped === 'bigint'
    ) {
      return String(dumped)
    }
    return JSON.stringify(dumped)
  } catch {
    try {
      return context.getString(handle)
    } catch {
      return ''
    }
  }
}

function isAbsentHandle(context: QuickJSAsyncContext, handle: QuickJSHandle): boolean {
  return context.typeof(handle) === 'undefined' || context.typeof(handle) === 'null'
}

function readOptionalPlainObject(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): Record<string, unknown> | undefined {
  if (handle === undefined || isAbsentHandle(context, handle)) {
    return undefined
  }
  if (context.typeof(handle) !== 'object') {
    return undefined
  }
  try {
    const dumped = context.dump(handle)
    if (dumped && typeof dumped === 'object' && !Array.isArray(dumped)) {
      return dumped as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  return undefined
}

function resolveFetchUrl(context: QuickJSAsyncContext, inputHandle: QuickJSHandle): string {
  if (context.typeof(inputHandle) === 'string') {
    return dumpArgString(context, inputHandle)
  }
  const record = readOptionalPlainObject(context, inputHandle)
  if (record) {
    if (typeof record.url === 'string') {
      return record.url
    }
    if (typeof record.href === 'string') {
      return record.href
    }
  }
  throw new TypeError('fetch input must be a URL string or Request-like object with url')
}

function parseFetchArgs(
  context: QuickJSAsyncContext,
  inputHandle: QuickJSHandle,
  initHandle: QuickJSHandle | undefined,
): { url: string; init?: RequestInit } {
  const url = resolveFetchUrl(context, inputHandle)
  const initOut: RequestInit = {}

  const initRecord = readOptionalPlainObject(context, initHandle)
  const inputRecord =
    context.typeof(inputHandle) === 'object'
      ? readOptionalPlainObject(context, inputHandle)
      : undefined

  const method =
    (typeof initRecord?.method === 'string' ? initRecord.method : undefined) ??
    (typeof inputRecord?.method === 'string' ? inputRecord.method : undefined)
  if (method !== undefined) {
    initOut.method = method
  }

  const headers =
    (initRecord?.headers as Record<string, string> | undefined) ??
    (inputRecord?.headers as Record<string, string> | undefined)
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    initOut.headers = headers
  }

  const bodyFromInit =
    initRecord?.body !== undefined && initHandle !== undefined && !isAbsentHandle(context, initHandle)
  const bodyFromInput =
    inputRecord?.body !== undefined && context.typeof(inputHandle) === 'object'

  if (bodyFromInit) {
    if (typeof initRecord!.body === 'string') {
      initOut.body = initRecord!.body
    } else {
      const bodyH = context.getProp(initHandle!, 'body')
      try {
        if (!isAbsentHandle(context, bodyH)) {
          initOut.body = readGuestBytes(context, bodyH)
        }
      } finally {
        bodyH.dispose()
      }
    }
  } else if (bodyFromInput) {
    if (typeof inputRecord!.body === 'string') {
      initOut.body = inputRecord!.body
    } else {
      const bodyH = context.getProp(inputHandle, 'body')
      try {
        if (!isAbsentHandle(context, bodyH)) {
          initOut.body = readGuestBytes(context, bodyH)
        }
      } finally {
        bodyH.dispose()
      }
    }
  }

  return {
    url,
    init: Object.keys(initOut).length > 0 ? initOut : undefined,
  }
}

function hostBytesToGuestBuffer(context: QuickJSAsyncContext, bytes: Uint8Array): QuickJSHandle {
  const abHandle = context.newArrayBuffer(copyHostBytes(bytes))
  context.setProp(context.global, TMP_AB_KEY, abHandle)
  abHandle.dispose()
  try {
    return context.unwrapResult(
      context.evalCode(`Buffer.from(globalThis.${TMP_AB_KEY})`, 'instant-fetch-buffer-wrap.js'),
    )
  } finally {
    context.setProp(context.global, TMP_AB_KEY, context.undefined)
  }
}

function headersToGuest(
  context: QuickJSAsyncContext,
  headers: Headers,
): QuickJSHandle {
  const obj = context.newObject()
  headers.forEach((value, key) => {
    const v = context.newString(value)
    context.setProp(obj, key, v)
    v.dispose()
  })
  return obj
}

type FetchStreamEntry = {
  reader: ReadableStreamDefaultReader<Uint8Array>
  accumulated: number
}

const QUICKJS_FETCH_GUEST_SOURCE = `(function () {
  'use strict';

  function Headers(init) {
    this._map = Object.create(null);
    if (init) {
      if (typeof init === 'object' && !Array.isArray(init)) {
        var keys = Object.keys(init);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          this.set(k, init[k]);
        }
      }
    }
  }

  Headers.prototype.get = function get(name) {
    var key = String(name).toLowerCase();
    return this._map[key] === undefined ? null : this._map[key];
  };

  Headers.prototype.set = function set(name, value) {
    this._map[String(name).toLowerCase()] = String(value);
  };

  // ---- Minimal Web ReadableStream (getReader / read / cancel) + Node pipe bridge ----

  function ReadableStream(source) {
    this.locked = false;
    this._pull = source.pull;   // async () => chunk | null
    this._cancel = source.cancel; // (reason?) => void | Promise<void>
  }

  ReadableStream.prototype.getReader = function getReader() {
    if (this.locked) throw new TypeError('ReadableStream is locked');
    this.locked = true;
    return new ReadableStreamDefaultReader(this._pull, this._cancel);
  };

  // Node.js stream .pipe() 桥接：让 pipeline(fetch().body, createWriteStream(...)) 可用
  ReadableStream.prototype.pipe = function pipe(dest, options) {
    var self = this;
    var reader = this.getReader();
    var ended = false;

    function pump() {
      if (ended) return;
      return reader.read().then(function (result) {
        if (ended) return;
        if (result.done) {
          ended = true;
          if (dest && typeof dest.end === 'function') {
            dest.end();
          }
          return;
        }
        var ok = true;
        if (dest && dest.writable !== false && typeof dest.write === 'function') {
          ok = dest.write(result.value);
        }
        if (ok === false) {
          // 背压：等 drain
          if (dest && typeof dest.once === 'function') {
            dest.once('drain', pump);
          }
          return;
        }
        return pump();
      }).catch(function (err) {
        if (ended) return;
        ended = true;
        if (dest && typeof dest.destroy === 'function') {
          dest.destroy(err);
        }
      });
    }

    pump();
    return dest;
  };

  function ReadableStreamDefaultReader(pull, cancel) {
    this._pull = pull;
    this._cancel = cancel;
    this._closed = false;
  }

  ReadableStreamDefaultReader.prototype.read = function read() {
    if (this._closed) return Promise.resolve({ value: undefined, done: true });
    var self = this;
    return Promise.resolve(this._pull()).then(function (chunk) {
      if (chunk === null || chunk === undefined) {
        self._closed = true;
        return { value: undefined, done: true };
      }
      return { value: chunk, done: false };
    });
  };

  ReadableStreamDefaultReader.prototype.cancel = function cancel(reason) {
    if (this._closed) return Promise.resolve();
    this._closed = true;
    try {
      var r = this._cancel(reason);
      return r instanceof Promise ? r : Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  };

  // ---- Response ----

  function Response(body, options) {
    options = options || {};
    this._body = body;           // legacy: ArrayBuffer / Uint8Array / Buffer
    this._streamId = options.streamId; // number: streaming fetch body
    this.status = options.status === undefined ? 200 : options.status;
    this.statusText = options.statusText === undefined ? '' : String(options.statusText);
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
    this.url = options.url === undefined ? '' : String(options.url);
    this.bodyUsed = false;
  }

  Object.defineProperty(Response.prototype, 'body', {
    enumerable: true,
    configurable: true,
    get: function () {
      if (this.bodyUsed) throw new TypeError('Body already used');
      if (this._streamId == null) return null;
      var sid = this._streamId;
      return new ReadableStream({
        pull: function () {
          return globalThis.${HOST_FETCH_STREAM_READ_KEY}(sid);
        },
        cancel: function () {
          globalThis.${HOST_FETCH_STREAM_CANCEL_KEY}(sid);
        },
      });
    },
  });

  function consumeStreamToArrayBuffer(sid) {
    var chunks = [];
    function readNext() {
      return globalThis.${HOST_FETCH_STREAM_READ_KEY}(sid).then(function (chunk) {
        if (chunk === null) {
          var total = 0;
          for (var i = 0; i < chunks.length; i++) total += chunks[i].byteLength;
          var result = new Uint8Array(total);
          var offset = 0;
          for (var i = 0; i < chunks.length; i++) {
            result.set(chunks[i], offset);
            offset += chunks[i].byteLength;
          }
          return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
        }
        chunks.push(chunk);
        return readNext();
      });
    }
    return readNext();
  }

  Response.prototype.arrayBuffer = function arrayBuffer() {
    if (this.bodyUsed) {
      return Promise.reject(new TypeError('Body already used'));
    }
    this.bodyUsed = true;

    // Streaming body
    if (this._streamId != null) {
      return consumeStreamToArrayBuffer(this._streamId);
    }

    // Legacy: non-streaming body
    var body = this._body;
    if (body == null) {
      return Promise.resolve(new ArrayBuffer(0));
    }
    if (body instanceof ArrayBuffer) {
      return Promise.resolve(body);
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
      return Promise.resolve(
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      );
    }
    if (body instanceof Uint8Array) {
      return Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    }
    return Promise.resolve(new TextEncoder().encode(String(body)).buffer);
  };

  Response.prototype.text = function text() {
    return this.arrayBuffer().then(function (ab) {
      return new TextDecoder().decode(ab);
    });
  };

  Response.prototype.json = function json() {
    return this.text().then(function (t) {
      return JSON.parse(t);
    });
  };

  Response.prototype.bytes = function bytes() {
    return this.arrayBuffer().then(function (ab) {
      return new Uint8Array(ab);
    });
  };

  // ---- fetch ----

  function fetch(input, init) {
    return globalThis.${HOST_FETCH_KEY}(input, init).then(function (packet) {
      var headers = new Headers(packet.headers);
      return new Response(
        packet.streamId != null ? undefined : packet.body,
        {
          status: packet.status,
          statusText: packet.statusText,
          headers: headers,
          url: packet.url,
          streamId: packet.streamId,
        },
      );
    });
  }

  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Response = Response;
  globalThis.ReadableStream = ReadableStream;
})();
`

export type InjectFetchOptions = {
  context: QuickJSAsyncContext
  asyncBridge: QuickJsAsyncBridge
  maxResponseBytes: number
  isDestroyed: () => boolean
  /** 网络域跨沙箱调用拦截链；未传则不包装 */
  syscallChain?: QuickJsSyscallChain
}

function guestError(context: QuickJSAsyncContext, error: unknown): QuickJSHandle {
  const message = error instanceof Error ? error.message : String(error)
  return context.unwrapResult(
    context.evalCode(
      `(function () { return new Error(${JSON.stringify(message)}); })()`,
      'instant-fetch-error.js',
    ),
  )
}

export function injectFetch(options: InjectFetchOptions): () => void {
  const { context, asyncBridge, maxResponseBytes, isDestroyed, syscallChain } = options

  let nextStreamId = 1
  const streams = new Map<number, FetchStreamEntry>()

  const runHostPromise = (work: () => Promise<QuickJSHandle>): QuickJSHandle => {
    const deferred = asyncBridge.createDeferredPromise()
    void (async () => {
      try {
        if (isDestroyed()) {
          throw new Error('QuickJS instance destroyed')
        }
        const value = await work()
        if (isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          if (value !== context.undefined && value.alive) {
            value.dispose()
          }
          return
        }
        asyncBridge.settleGuestPromise(deferred, { ok: true, value })
        if (value !== context.undefined && value.alive) {
          value.dispose()
        }
      } catch (error) {
        if (isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          return
        }
        asyncBridge.settleGuestPromise(deferred, {
          ok: false,
          error: guestError(context, error),
        })
      }
    })()
    return deferred.handle
  }

  const fetchFn = context.newFunction(HOST_FETCH_KEY, (inputHandle, initHandle) => {
    const deferred = asyncBridge.createDeferredPromise()
    void (async () => {
      try {
        if (isDestroyed()) {
          throw new Error('QuickJS instance destroyed')
        }
        const { url, init } = parseFetchArgs(context, inputHandle, initHandle)
        const fetchParams: Record<string, unknown> = {
          url,
          method:
            typeof init?.method === 'string' && init.method.length > 0 ? init.method : 'GET',
        }
        // 网络域出沙箱：before 可拒绝（抛错）或改写 params.url 后再真正请求
        const response = await dispatchSyscallIfExists(
          syscallChain,
          'network.fetch',
          fetchParams,
          async () => {
            const targetUrl = typeof fetchParams.url === 'string' ? fetchParams.url : url
            return hostFetch(targetUrl, init)
          },
        )

        if (isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          return
        }

        const packet = context.newObject()

        const okHandle = response.ok ? context.true : context.false
        context.setProp(packet, 'ok', okHandle)
        okHandle.dispose()

        const statusHandle = context.newNumber(response.status)
        context.setProp(packet, 'status', statusHandle)
        statusHandle.dispose()

        const statusTextHandle = context.newString(response.statusText)
        context.setProp(packet, 'statusText', statusTextHandle)
        statusTextHandle.dispose()

        const urlHandle = context.newString(response.url)
        context.setProp(packet, 'url', urlHandle)
        urlHandle.dispose()

        const headersHandle = headersToGuest(context, response.headers)
        context.setProp(packet, 'headers', headersHandle)
        headersHandle.dispose()

        // Streaming: store reader, return streamId (no body bytes)
        const reader = response.body!.getReader()
        const streamId = nextStreamId++
        streams.set(streamId, { reader, accumulated: 0 })

        const sidHandle = context.newNumber(streamId)
        context.setProp(packet, 'streamId', sidHandle)
        sidHandle.dispose()

        if (isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          packet.dispose()
          streams.delete(streamId)
          void reader.cancel()
          return
        }
        asyncBridge.settleGuestPromise(deferred, { ok: true, value: packet })
        packet.dispose()
      } catch (error) {
        if (isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          return
        }
        asyncBridge.settleGuestPromise(deferred, {
          ok: false,
          error: guestError(context, error),
        })
      }
    })()
    return deferred.handle
  })
  context.setProp(context.global, HOST_FETCH_KEY, fetchFn)
  fetchFn.dispose()

  // ---- fetch stream read ----
  const readStream = context.newFunction(HOST_FETCH_STREAM_READ_KEY, (streamIdHandle) =>
    runHostPromise(async () => {
      const streamId = context.getNumber(streamIdHandle)
      const entry = streams.get(streamId)
      if (!entry) {
        return context.null
      }
      const { reader } = entry
      try {
        const result = (await dispatchSyscallIfExists(
          syscallChain,
          'network.fetchStream.read',
          { streamId },
          () => reader.read(),
        )) as ReadableStreamReadResult<Uint8Array>
        if (result.done) {
          streams.delete(streamId)
          return context.null
        }
        const chunk = result.value
        const next = entry.accumulated + chunk.byteLength
        if (next > maxResponseBytes) {
          streams.delete(streamId)
          void reader.cancel()
          throw new Error(
            `Fetch response body exceeds maxFileBytes (${maxResponseBytes}): received ${next} bytes`,
          )
        }
        entry.accumulated = next
        return hostBytesToGuestBuffer(context, chunk)
      } catch (error) {
        streams.delete(streamId)
        void reader.cancel().catch(() => {})
        throw error
      }
    }),
  )
  context.setProp(context.global, HOST_FETCH_STREAM_READ_KEY, readStream)
  readStream.dispose()

  // ---- fetch stream cancel ----
  const cancelStream = context.newFunction(HOST_FETCH_STREAM_CANCEL_KEY, (streamIdHandle) => {
    const streamId = context.getNumber(streamIdHandle)
    const entry = streams.get(streamId)
    if (entry) {
      streams.delete(streamId)
      void dispatchSyscallIfExists(syscallChain, 'network.fetchStream.cancel', { streamId }, () =>
        entry.reader.cancel(),
      )
    }
    return context.undefined
  })
  context.setProp(context.global, HOST_FETCH_STREAM_CANCEL_KEY, cancelStream)
  cancelStream.dispose()

  const boot = context.evalCode(QUICKJS_FETCH_GUEST_SOURCE, 'instant-fetch-guest.js')
  if (boot.error) {
    context.setProp(context.global, HOST_FETCH_KEY, context.undefined)
    context.setProp(context.global, HOST_FETCH_STREAM_READ_KEY, context.undefined)
    context.setProp(context.global, HOST_FETCH_STREAM_CANCEL_KEY, context.undefined)
    const message = (() => {
      try {
        return String(context.dump(boot.error))
      } catch {
        return 'fetch guest eval failed'
      } finally {
        boot.error.dispose()
      }
    })()
    throw new Error(`Failed to inject fetch: ${message}`)
  }
  boot.value.dispose()

  return () => {
    context.setProp(context.global, HOST_FETCH_KEY, context.undefined)
    context.setProp(context.global, HOST_FETCH_STREAM_READ_KEY, context.undefined)
    context.setProp(context.global, HOST_FETCH_STREAM_CANCEL_KEY, context.undefined)
    context.setProp(context.global, 'fetch', context.undefined)
    context.setProp(context.global, 'Headers', context.undefined)
    context.setProp(context.global, 'Response', context.undefined)
    context.setProp(context.global, 'ReadableStream', context.undefined)
    // Clean up any remaining stream readers
    for (const [, entry] of streams) {
      void entry.reader.cancel()
    }
    streams.clear()
  }
}
