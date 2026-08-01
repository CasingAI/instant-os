import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'
import { hmac } from '@noble/hashes/hmac.js'
import { sha1, md5 } from '@noble/hashes/legacy.js'
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js'

const CRYPTO_BUNDLE_GLOBAL_KEY = '__instantCryptoBundle'
const HOST_RANDOM_BYTES_KEY = '__instantCryptoRandomBytes'
const HOST_RANDOM_UUID_KEY = '__instantCryptoRandomUUID'
const HOST_HASH_CREATE_KEY = '__instantCryptoHashCreate'
const HOST_HASH_UPDATE_KEY = '__instantCryptoHashUpdate'
const HOST_HASH_DIGEST_KEY = '__instantCryptoHashDigest'
const HOST_HMAC_CREATE_KEY = '__instantCryptoHmacCreate'
const HOST_HMAC_UPDATE_KEY = '__instantCryptoHmacUpdate'
const HOST_HMAC_DIGEST_KEY = '__instantCryptoHmacDigest'
const TMP_AB_KEY = '__instantTmpArrayBuffer'

type HashLike = {
  update: (data: Uint8Array) => HashLike
  digest: () => Uint8Array
}

type AlgoFactory = () => HashLike

const ALGO_FACTORIES: Record<string, AlgoFactory> = {
  sha1: () => sha1.create(),
  sha256: () => sha256.create(),
  sha384: () => sha384.create(),
  sha512: () => sha512.create(),
  md5: () => md5.create(),
}

const HMAC_ALGOS: Record<string, typeof sha256> = {
  sha1,
  sha256,
  sha384,
  sha512,
  md5,
}

function normalizeAlgo(raw: string): string {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/^sha-/, 'sha')
}

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
        'The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView',
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

function readDataArg(context: QuickJSContext, handle: QuickJSHandle): Uint8Array {
  if (context.typeof(handle) === 'string') {
    return new TextEncoder().encode(context.getString(handle))
  }
  return readGuestBytes(context, handle)
}

function dumpArgString(context: QuickJSContext, handle: QuickJSHandle): string {
  try {
    const dumped = context.dump(handle)
    if (typeof dumped === 'string') return dumped
    return String(dumped)
  } catch {
    return context.getString(handle)
  }
}

function isAbsentHandle(context: QuickJSContext, handle: QuickJSHandle | undefined): boolean {
  if (handle === undefined) return true
  return context.typeof(handle) === 'undefined' || context.typeof(handle) === 'null'
}

function installHostBridges(context: QuickJSContext): () => void {
  let nextId = 1
  const hashes = new Map<number, HashLike>()
  const hmacs = new Map<number, HashLike>()

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

  const hashCreateFn = context.newFunction(HOST_HASH_CREATE_KEY, (algoHandle) => {
    const algo = normalizeAlgo(dumpArgString(context, algoHandle))
    const factory = ALGO_FACTORIES[algo]
    if (!factory) {
      throw new Error(
        `Digest method not supported: ${algo}. Instant crypto supports sha1, sha256, sha384, sha512, md5.`,
      )
    }
    const id = nextId++
    hashes.set(id, factory())
    return context.newNumber(id)
  })
  context.setProp(context.global, HOST_HASH_CREATE_KEY, hashCreateFn)
  hashCreateFn.dispose()

  const hashUpdateFn = context.newFunction(HOST_HASH_UPDATE_KEY, (idHandle, dataHandle) => {
    const id = context.getNumber(idHandle)
    const h = hashes.get(id)
    if (!h) throw new Error('Hash instance disposed or unknown')
    h.update(readDataArg(context, dataHandle))
    return context.undefined
  })
  context.setProp(context.global, HOST_HASH_UPDATE_KEY, hashUpdateFn)
  hashUpdateFn.dispose()

  const hashDigestFn = context.newFunction(HOST_HASH_DIGEST_KEY, (idHandle, encHandle) => {
    const id = context.getNumber(idHandle)
    const h = hashes.get(id)
    if (!h) throw new Error('Hash instance disposed or unknown')
    hashes.delete(id)
    const digest = h.digest()
    if (!isAbsentHandle(context, encHandle)) {
      const enc = dumpArgString(context, encHandle!).toLowerCase()
      if (enc === 'hex') {
        return context.newString(
          [...digest].map((b) => b.toString(16).padStart(2, '0')).join(''),
        )
      }
      if (enc === 'base64') {
        let binary = ''
        for (const b of digest) binary += String.fromCharCode(b)
        return context.newString(btoa(binary))
      }
    }
    return hostBytesToGuestBuffer(context, digest)
  })
  context.setProp(context.global, HOST_HASH_DIGEST_KEY, hashDigestFn)
  hashDigestFn.dispose()

  const hmacCreateFn = context.newFunction(
    HOST_HMAC_CREATE_KEY,
    (algoHandle, keyHandle) => {
      const algo = normalizeAlgo(dumpArgString(context, algoHandle))
      const hashFn = HMAC_ALGOS[algo]
      if (!hashFn) {
        throw new Error(
          `HMAC Digest method not supported: ${algo}. Instant crypto supports sha1, sha256, sha384, sha512, md5.`,
        )
      }
      const key = readDataArg(context, keyHandle)
      const id = nextId++
      hmacs.set(id, hmac.create(hashFn, key))
      return context.newNumber(id)
    },
  )
  context.setProp(context.global, HOST_HMAC_CREATE_KEY, hmacCreateFn)
  hmacCreateFn.dispose()

  const hmacUpdateFn = context.newFunction(HOST_HMAC_UPDATE_KEY, (idHandle, dataHandle) => {
    const id = context.getNumber(idHandle)
    const h = hmacs.get(id)
    if (!h) throw new Error('Hmac instance disposed or unknown')
    h.update(readDataArg(context, dataHandle))
    return context.undefined
  })
  context.setProp(context.global, HOST_HMAC_UPDATE_KEY, hmacUpdateFn)
  hmacUpdateFn.dispose()

  const hmacDigestFn = context.newFunction(HOST_HMAC_DIGEST_KEY, (idHandle, encHandle) => {
    const id = context.getNumber(idHandle)
    const h = hmacs.get(id)
    if (!h) throw new Error('Hmac instance disposed or unknown')
    hmacs.delete(id)
    const digest = h.digest()
    if (!isAbsentHandle(context, encHandle)) {
      const enc = dumpArgString(context, encHandle!).toLowerCase()
      if (enc === 'hex') {
        return context.newString(
          [...digest].map((b) => b.toString(16).padStart(2, '0')).join(''),
        )
      }
      if (enc === 'base64') {
        let binary = ''
        for (const b of digest) binary += String.fromCharCode(b)
        return context.newString(btoa(binary))
      }
    }
    return hostBytesToGuestBuffer(context, digest)
  })
  context.setProp(context.global, HOST_HMAC_DIGEST_KEY, hmacDigestFn)
  hmacDigestFn.dispose()

  return () => {
    hashes.clear()
    hmacs.clear()
    context.setProp(context.global, HOST_RANDOM_BYTES_KEY, context.undefined)
    context.setProp(context.global, HOST_RANDOM_UUID_KEY, context.undefined)
    context.setProp(context.global, HOST_HASH_CREATE_KEY, context.undefined)
    context.setProp(context.global, HOST_HASH_UPDATE_KEY, context.undefined)
    context.setProp(context.global, HOST_HASH_DIGEST_KEY, context.undefined)
    context.setProp(context.global, HOST_HMAC_CREATE_KEY, context.undefined)
    context.setProp(context.global, HOST_HMAC_UPDATE_KEY, context.undefined)
    context.setProp(context.global, HOST_HMAC_DIGEST_KEY, context.undefined)
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

  function Hash(id) {
    this._id = id;
    this._done = false;
  }
  Hash.prototype.update = function update(data, encoding) {
    if (this._done) {
      throw new Error('Digest already called');
    }
    var buf = data;
    if (typeof data === 'string') {
      buf = Buffer.from(data, encoding || 'utf8');
    }
    globalThis.${HOST_HASH_UPDATE_KEY}(this._id, buf);
    return this;
  };
  Hash.prototype.digest = function digest(encoding) {
    if (this._done) {
      throw new Error('Digest already called');
    }
    this._done = true;
    return globalThis.${HOST_HASH_DIGEST_KEY}(this._id, encoding);
  };

  function Hmac(id) {
    this._id = id;
    this._done = false;
  }
  Hmac.prototype.update = function update(data, encoding) {
    if (this._done) {
      throw new Error('Digest already called');
    }
    var buf = data;
    if (typeof data === 'string') {
      buf = Buffer.from(data, encoding || 'utf8');
    }
    globalThis.${HOST_HMAC_UPDATE_KEY}(this._id, buf);
    return this;
  };
  Hmac.prototype.digest = function digest(encoding) {
    if (this._done) {
      throw new Error('Digest already called');
    }
    this._done = true;
    return globalThis.${HOST_HMAC_DIGEST_KEY}(this._id, encoding);
  };

  function createHash(algorithm) {
    var id = globalThis.${HOST_HASH_CREATE_KEY}(algorithm);
    return new Hash(id);
  }

  function createHmac(algorithm, key) {
    var keyBuf = typeof key === 'string' ? Buffer.from(key, 'utf8') : key;
    var id = globalThis.${HOST_HMAC_CREATE_KEY}(algorithm, keyBuf);
    return new Hmac(id);
  }

  globalThis.${CRYPTO_BUNDLE_GLOBAL_KEY} = {
    randomBytes: randomBytes,
    randomUUID: randomUUID,
    createHash: createHash,
    createHmac: createHmac,
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

const CRYPTO_EXPORT_KEYS = [
  'randomBytes',
  'randomUUID',
  'createHash',
  'createHmac',
] as const

export function buildCryptoModuleSource(builtinsGlobalKey: string): string {
  const named = CRYPTO_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return `const __m = globalThis.${builtinsGlobalKey}.crypto;\n${named}\nexport default __m;\n`
}
