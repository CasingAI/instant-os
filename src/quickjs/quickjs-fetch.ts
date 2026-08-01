import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten'
import {
  proxiedFetch,
  ProxyServerApiError,
  PROXY_SERVER_NOT_CONFIGURED_MESSAGE,
} from '../os/proxy-server-api.ts'
import { isProxyServerConnected } from '../os/proxy-server-settings-storage.ts'
import type { QuickJsAsyncBridge } from './quickjs-async-bridge.ts'

const HOST_FETCH_KEY = '__instantHostFetch'
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

async function readResponseBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > maxBytes) {
    throw new Error(
      `Fetch response body exceeds maxFileBytes (${maxBytes}): received ${buffer.byteLength} bytes`,
    )
  }
  return new Uint8Array(buffer)
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

  function Response(body, options) {
    options = options || {};
    this._body = body;
    this.status = options.status === undefined ? 200 : options.status;
    this.statusText = options.statusText === undefined ? '' : String(options.statusText);
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
    this.url = options.url === undefined ? '' : String(options.url);
    this.bodyUsed = false;
  }

  Response.prototype.arrayBuffer = function arrayBuffer() {
    if (this.bodyUsed) {
      return Promise.reject(new TypeError('Body already used'));
    }
    this.bodyUsed = true;
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

  function fetch(input, init) {
    return globalThis.${HOST_FETCH_KEY}(input, init).then(function (packet) {
      var headers = new Headers(packet.headers);
      return new Response(packet.body, {
        status: packet.status,
        statusText: packet.statusText,
        headers: headers,
        url: packet.url,
      });
    });
  }

  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Response = Response;
})();
`

export type InjectFetchOptions = {
  context: QuickJSAsyncContext
  asyncBridge: QuickJsAsyncBridge
  maxResponseBytes: number
  isDestroyed: () => boolean
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
  const { context, asyncBridge, maxResponseBytes, isDestroyed } = options

  const fetchFn = context.newFunction(HOST_FETCH_KEY, (inputHandle, initHandle) => {
    const deferred = asyncBridge.createDeferredPromise()
    void (async () => {
      try {
        if (isDestroyed()) {
          throw new Error('QuickJS instance destroyed')
        }
        const { url, init } = parseFetchArgs(context, inputHandle, initHandle)
        const response = await hostFetch(url, init)
        const bytes = await readResponseBodyLimited(response, maxResponseBytes)

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

        const bodyHandle = hostBytesToGuestBuffer(context, bytes)
        context.setProp(packet, 'body', bodyHandle)
        bodyHandle.dispose()

        if (isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          packet.dispose()
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

  const boot = context.evalCode(QUICKJS_FETCH_GUEST_SOURCE, 'instant-fetch-guest.js')
  if (boot.error) {
    context.setProp(context.global, HOST_FETCH_KEY, context.undefined)
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
    context.setProp(context.global, 'fetch', context.undefined)
    context.setProp(context.global, 'Headers', context.undefined)
    context.setProp(context.global, 'Response', context.undefined)
  }
}
