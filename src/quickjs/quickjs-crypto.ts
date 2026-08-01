import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

const CRYPTO_BUNDLE_GLOBAL_KEY = '__instantCryptoBundle'
const HOST_RANDOM_BYTES_KEY = '__instantCryptoRandomBytes'
const HOST_RANDOM_UUID_KEY = '__instantCryptoRandomUUID'
const TMP_AB_KEY = '__instantTmpArrayBuffer'

function copyHostBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function requireHostGetRandomValues(): (array: Uint8Array) => Uint8Array {
  const crypto = globalThis.crypto
  if (!crypto || typeof crypto.getRandomValues !== 'function') {
    throw new Error(
      'Host globalThis.crypto.getRandomValues is unavailable; Instant crypto.randomBytes requires it',
    )
  }
  return crypto.getRandomValues.bind(crypto)
}

function hostRandomBytes(size: number): Uint8Array {
  if (!Number.isFinite(size) || size < 0 || size > 0x7fffffff) {
    throw new RangeError('size must be a non-negative finite number')
  }
  const n = Math.floor(size)
  const bytes = new Uint8Array(n)
  if (n > 0) {
    requireHostGetRandomValues()(bytes)
  }
  return bytes
}

function hostRandomUuid(): string {
  const crypto = globalThis.crypto as Crypto & { randomUUID?: () => string }
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = hostRandomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function hostBytesToGuestBuffer(context: QuickJSContext, bytes: Uint8Array): QuickJSHandle {
  const abHandle = context.newArrayBuffer(copyHostBytes(bytes))
  context.setProp(context.global, TMP_AB_KEY, abHandle)
  abHandle.dispose()
  try {
    return context.unwrapResult(
      context.evalCode(`Buffer.from(globalThis.${TMP_AB_KEY})`, 'instant-crypto-buffer-wrap.js'),
    )
  } finally {
    context.setProp(context.global, TMP_AB_KEY, context.undefined)
  }
}

function installHostBridges(context: QuickJSContext): () => void {
  const randomBytesFn = context.newFunction(HOST_RANDOM_BYTES_KEY, (sizeHandle) => {
    let size = 0
    try {
      size = context.getNumber(sizeHandle)
    } catch {
      const dumped = context.dump(sizeHandle)
      size = Number(dumped)
    }
    return hostBytesToGuestBuffer(context, hostRandomBytes(size))
  })
  context.setProp(context.global, HOST_RANDOM_BYTES_KEY, randomBytesFn)
  randomBytesFn.dispose()

  const randomUuidFn = context.newFunction(HOST_RANDOM_UUID_KEY, () =>
    context.newString(hostRandomUuid()),
  )
  context.setProp(context.global, HOST_RANDOM_UUID_KEY, randomUuidFn)
  randomUuidFn.dispose()

  return () => {
    context.setProp(context.global, HOST_RANDOM_BYTES_KEY, context.undefined)
    context.setProp(context.global, HOST_RANDOM_UUID_KEY, context.undefined)
  }
}

const QUICKJS_CRYPTO_GUEST_SOURCE = `(function () {
  'use strict';

  function randomBytes(size, callback) {
    var n = Number(size);
    if (!isFinite(n) || n < 0) {
      throw new RangeError('The value of "size" is out of range. It must be a non-negative number.');
    }
    n = Math.floor(n);
    var buf = globalThis.${HOST_RANDOM_BYTES_KEY}(n);
    if (typeof callback === 'function') {
      globalThis.setTimeout(function () {
        callback(null, buf);
      }, 0);
      return;
    }
    return buf;
  }

  function randomUUID() {
    return globalThis.${HOST_RANDOM_UUID_KEY}();
  }

  globalThis.${CRYPTO_BUNDLE_GLOBAL_KEY} = {
    randomBytes: randomBytes,
    randomUUID: randomUUID,
  };
})();
`

export type InjectCryptoResult = {
  handle: QuickJSHandle
  dispose: () => void
}

export function injectCrypto(context: QuickJSContext): InjectCryptoResult {
  const disposeBridges = installHostBridges(context)

  const evalResult = context.evalCode(QUICKJS_CRYPTO_GUEST_SOURCE, 'instant-crypto.js')
  if (evalResult.error) {
    disposeBridges()
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'crypto guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject crypto: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, CRYPTO_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    disposeBridges()
    handle.dispose()
    throw new Error('Failed to inject crypto: module object missing')
  }

  context.setProp(context.global, CRYPTO_BUNDLE_GLOBAL_KEY, context.undefined)
  return { handle, dispose: disposeBridges }
}

const CRYPTO_EXPORT_KEYS = ['randomBytes', 'randomUUID'] as const

export function buildCryptoModuleSource(builtinsGlobalKey: string): string {
  const named = CRYPTO_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return `const __m = globalThis.${builtinsGlobalKey}.crypto;\n${named}\nexport default __m;\n`
}
