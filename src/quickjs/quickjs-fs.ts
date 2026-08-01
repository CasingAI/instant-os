import type {
  QuickJSAsyncContext,
  QuickJSHandle,
} from 'quickjs-emscripten'
import type { QuickJsAsyncBridge } from './quickjs-async-bridge.ts'
import { filesWatch } from '../apps/files/files-api.ts'
import type { FilesWatchChange } from '../apps/files/files-api.ts'
import { QuickJsFsError, isQuickJsFsError, toQuickJsFsError } from './quickjs-fs-errors.ts'
import { resolveGuestFsPath } from './quickjs-fs-path.ts'
import { createPosixPathApi } from './quickjs-path.ts'
import type { QuickJsFsDirent, QuickJsFsHostOps, QuickJsFsStats } from './quickjs-fs-vfs.ts'
import {
  fsHostAccess,
  fsHostAppendFile,
  fsHostChmod,
  fsHostChown,
  fsHostCopyFile,
  fsHostExists,
  fsHostLstat,
  fsHostMkdir,
  fsHostMkdtemp,
  fsHostReadFile,
  fsHostReadFileForStream,
  fsHostReaddir,
  fsHostReadlink,
  fsHostRealpath,
  fsHostRename,
  fsHostRm,
  fsHostRmdir,
  fsHostStat,
  fsHostSymlink,
  fsHostTruncate,
  fsHostUnlink,
  fsHostWriteFile,
} from './quickjs-fs-vfs.ts'

/** Node `fs.constants` 子集（access / open 标志）。 */
export const INSTANT_FS_CONSTANTS = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  COPYFILE_EXCL: 1,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,
} as const

const TMP_AB_KEY = '__instantFsTmpArrayBuffer'

export type InjectFsOptions = {
  context: QuickJSAsyncContext
  asyncBridge: QuickJsAsyncBridge
  ops: QuickJsFsHostOps
  /** stream 模块 handle（含 Readable / Writable），用于 createReadStream / createWriteStream */
  streamHandle?: QuickJSHandle
}

function copyHostBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function dumpPrimitive(context: QuickJSAsyncContext, handle: QuickJSHandle): unknown {
  try {
    return context.dump(handle)
  } catch {
    try {
      return context.getString(handle)
    } catch {
      return undefined
    }
  }
}

function readGuestBytes(context: QuickJSAsyncContext, handle: QuickJSHandle): Uint8Array {
  try {
    const lifetime = context.getArrayBuffer(handle)
    try {
      return new Uint8Array(lifetime.value)
    } finally {
      lifetime.dispose()
    }
  } catch {
    // TypedArray / Buffer
  }

  let bufferHandle: QuickJSHandle | undefined
  let offsetHandle: QuickJSHandle | undefined
  let lengthHandle: QuickJSHandle | undefined
  try {
    bufferHandle = context.getProp(handle, 'buffer')
    if (context.typeof(bufferHandle) === 'undefined') {
      throw new QuickJsFsError(
        'ERR_INVALID_ARG_TYPE',
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
      return length === undefined
        ? new Uint8Array(view.subarray(offset))
        : new Uint8Array(view.subarray(offset, offset + length))
    } finally {
      lifetime.dispose()
    }
  } finally {
    lengthHandle?.dispose()
    offsetHandle?.dispose()
    bufferHandle?.dispose()
  }
}

function parseWriteData(context: QuickJSAsyncContext, handle: QuickJSHandle): string | Uint8Array {
  const dumped = dumpPrimitive(context, handle)
  if (typeof dumped === 'string') {
    return dumped
  }
  if (typeof dumped === 'number' || typeof dumped === 'boolean' || typeof dumped === 'bigint') {
    return String(dumped)
  }
  return readGuestBytes(context, handle)
}

function normalizeEncoding(value: unknown): 'utf8' | 'buffer' {
  if (value === undefined || value === null) {
    return 'buffer'
  }
  if (typeof value === 'string') {
    const n = value.trim().toLowerCase().replace(/[_ ]/g, '-')
    if (n === 'utf8' || n === 'utf-8') {
      return 'utf8'
    }
    if (n === 'buffer' || n === '') {
      return 'buffer'
    }
    throw new QuickJsFsError(
      'ERR_INVALID_ARG_VALUE',
      `The value '${value}' is invalid for option "encoding". Instant fs supports utf8 or buffer.`,
    )
  }
  if (typeof value === 'object' && value !== null && 'encoding' in value) {
    return normalizeEncoding((value as { encoding?: unknown }).encoding)
  }
  return 'buffer'
}

function hostBytesToGuestBuffer(context: QuickJSAsyncContext, bytes: Uint8Array): QuickJSHandle {
  const abHandle = context.newArrayBuffer(copyHostBytes(bytes))
  context.setProp(context.global, TMP_AB_KEY, abHandle)
  abHandle.dispose()
  try {
    return context.unwrapResult(
      context.evalCode(
        `Buffer.from(globalThis.${TMP_AB_KEY})`,
        'instant-fs-buffer-wrap.js',
      ),
    )
  } finally {
    context.setProp(context.global, TMP_AB_KEY, context.undefined)
  }
}

function hostStatsToGuest(context: QuickJSAsyncContext, stats: QuickJsFsStats): QuickJSHandle {
  const obj = context.newObject()
  const setNumber = (key: string, value: number) => {
    const h = context.newNumber(value)
    context.setProp(obj, key, h)
    h.dispose()
  }
  setNumber('size', stats.size)
  setNumber('mtimeMs', stats.mtimeMs)
  setNumber('ctimeMs', stats.ctimeMs)
  setNumber('birthtimeMs', stats.birthtimeMs)
  setNumber('atimeMs', stats.atimeMs)
  setNumber('mode', stats.mode)
  setNumber('uid', stats.uid)
  setNumber('gid', stats.gid)
  setNumber('ino', stats.ino)
  setNumber('dev', stats.dev)
  setNumber('nlink', stats.nlink)
  setNumber('blocks', stats.blocks)
  setNumber('blksize', stats.blksize)

  const setDate = (key: string, ms: number) => {
    const h = context.unwrapResult(context.evalCode(`new Date(${ms})`))
    context.setProp(obj, key, h)
    h.dispose()
  }
  setDate('mtime', stats.mtimeMs)
  setDate('ctime', stats.ctimeMs)
  setDate('birthtime', stats.birthtimeMs)
  setDate('atime', stats.atimeMs)

  const bindBool = (name: string, value: boolean) => {
    const fn = context.newFunction(name, () => (value ? context.true : context.false))
    context.setProp(obj, name, fn)
    fn.dispose()
  }
  bindBool('isFile', stats.isFile)
  bindBool('isDirectory', stats.isDirectory)
  bindBool('isSymbolicLink', stats.isSymbolicLink)
  bindBool('isBlockDevice', stats.isBlockDevice)
  bindBool('isCharacterDevice', stats.isCharacterDevice)
  bindBool('isFIFO', stats.isFIFO)
  bindBool('isSocket', stats.isSocket)

  return obj
}

function createGuestFsError(context: QuickJSAsyncContext, error: unknown): QuickJSHandle {
  const fsError = isQuickJsFsError(error) ? error : toQuickJsFsError(error)
  const payload = {
    message: fsError.message,
    code: fsError.code,
    path: fsError.path,
    syscall: fsError.syscall,
    errno: fsError.errno,
    name: 'Error',
  }
  return context.unwrapResult(
    context.evalCode(
      `(function () {
        var e = new Error(${JSON.stringify(payload.message)});
        e.code = ${JSON.stringify(payload.code)};
        e.name = 'Error';
        ${payload.path !== undefined ? `e.path = ${JSON.stringify(payload.path)};` : ''}
        ${payload.syscall !== undefined ? `e.syscall = ${JSON.stringify(payload.syscall)};` : ''}
        ${payload.errno !== undefined ? `e.errno = ${JSON.stringify(payload.errno)};` : ''}
        return e;
      })()`,
      'instant-fs-error.js',
    ),
  )
}

function encodeReadResult(
  context: QuickJSAsyncContext,
  value: string | Uint8Array,
): QuickJSHandle {
  if (typeof value === 'string') {
    return context.newString(value)
  }
  return hostBytesToGuestBuffer(context, value)
}

function encodeVoid(_context: QuickJSAsyncContext): QuickJSHandle | undefined {
  return undefined
}

function encodeStringArray(context: QuickJSAsyncContext, names: string[]): QuickJSHandle {
  return context.unwrapResult(context.evalCode(`(${JSON.stringify(names)})`))
}

function encodeMkdirResult(context: QuickJSAsyncContext, path: string | undefined): QuickJSHandle {
  if (path === undefined) {
    return context.undefined
  }
  return context.newString(path)
}

function encodeReaddirResult(
  context: QuickJSAsyncContext,
  names: string[] | QuickJsFsDirent[],
): QuickJSHandle {
  if (names.length === 0) {
    return encodeStringArray(context, [])
  }
  if (typeof names[0] === 'string') {
    return encodeStringArray(context, names as string[])
  }
  const arr = context.newArray()
  let index = 0
  for (const entry of names as QuickJsFsDirent[]) {
    const h = direntToGuest(context, entry)
    context.setProp(arr, String(index), h)
    h.dispose()
    index += 1
  }
  const lenHandle = context.newNumber(index)
  context.setProp(arr, 'length', lenHandle)
  lenHandle.dispose()
  return arr
}

function direntToGuest(context: QuickJSAsyncContext, entry: QuickJsFsDirent): QuickJSHandle {
  const obj = context.newObject()
  const nameHandle = context.newString(entry.name)
  context.setProp(obj, 'name', nameHandle)
  nameHandle.dispose()
  const bindBool = (method: string, value: boolean) => {
    const fn = context.newFunction(method, () => (value ? context.true : context.false))
    context.setProp(obj, method, fn)
    fn.dispose()
  }
  bindBool('isFile', entry.isFile)
  bindBool('isDirectory', entry.isDirectory)
  bindBool('isSymbolicLink', entry.isSymbolicLink)
  return obj
}

function parseReaddirOptions(
  context: QuickJSAsyncContext,
  args: QuickJSHandle[],
  hasCb: boolean,
): { withFileTypes?: boolean } | undefined {
  const optsHandle = hasCb
    ? args.length >= 3 && context.typeof(args[1]!) === 'object'
      ? args[1]
      : undefined
    : args.length >= 2 && context.typeof(args[1]!) === 'object'
      ? args[1]
      : undefined
  if (optsHandle === undefined) {
    return undefined
  }
  return dumpPrimitive(context, optsHandle) as { withFileTypes?: boolean }
}

function mapFilesWatchEvent(change: FilesWatchChange): 'rename' | 'change' {
  return change.kind === 'modified' ? 'change' : 'rename'
}

function injectFsConstants(context: QuickJSAsyncContext, fsObject: QuickJSHandle): void {
  const constants = context.newObject()
  for (const [key, value] of Object.entries(INSTANT_FS_CONSTANTS)) {
    const num = context.newNumber(value)
    context.setProp(constants, key, num)
    num.dispose()
  }
  context.setProp(fsObject, 'constants', constants)
  constants.dispose()
}

function isGuestFunction(context: QuickJSAsyncContext, handle: QuickJSHandle | undefined): boolean {
  if (handle === undefined) {
    return false
  }
  return context.typeof(handle) === 'function'
}

const FS_STREAM_BUNDLE_KEY = '__instantFsStreamBundle'
const FS_STREAM_READABLE_KEY = '__instantFsReadable'
const FS_STREAM_WRITABLE_KEY = '__instantFsWritable'
const HOST_FS_OPEN_READ_KEY = '__instantFsOpenRead'
const HOST_FS_READ_CHUNK_KEY = '__instantFsReadChunk'
const HOST_FS_CLOSE_READ_KEY = '__instantFsCloseRead'
const HOST_FS_OPEN_WRITE_KEY = '__instantFsOpenWrite'
const HOST_FS_WRITE_CHUNK_KEY = '__instantFsWriteChunk'
const HOST_FS_CLOSE_WRITE_KEY = '__instantFsCloseWrite'

type FsReadStreamState = { bytes: Uint8Array; offset: number; path: string }
type FsWriteStreamState = { path: string; written: number; chunks: Uint8Array[] }

function injectFsStreams(params: {
  context: QuickJSAsyncContext
  asyncBridge: QuickJsAsyncBridge
  ops: QuickJsFsHostOps
  fsObject: QuickJSHandle
  streamHandle: QuickJSHandle
}): void {
  const { context, asyncBridge, ops, fsObject, streamHandle } = params
  let nextId = 1
  const reads = new Map<number, FsReadStreamState>()
  const writes = new Map<number, FsWriteStreamState>()

  const runHostPromise = (work: () => Promise<QuickJSHandle>): QuickJSHandle => {
    const deferred = asyncBridge.createDeferredPromise()
    void (async () => {
      try {
        if (ops.isDestroyed()) {
          throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed')
        }
        const value = await work()
        if (ops.isDestroyed()) {
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
        if (ops.isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          return
        }
        asyncBridge.settleGuestPromise(deferred, {
          ok: false,
          error: createGuestFsError(context, error),
        })
      }
    })()
    return deferred.handle
  }

  const openRead = context.newFunction(HOST_FS_OPEN_READ_KEY, (pathHandle) =>
    runHostPromise(async () => {
      const raw = dumpPrimitive(context, pathHandle)
      const { absolute, bytes } = await fsHostReadFileForStream(ops, raw)
      const id = nextId++
      reads.set(id, { bytes, offset: 0, path: absolute })
      return context.newNumber(id)
    }),
  )
  context.setProp(context.global, HOST_FS_OPEN_READ_KEY, openRead)
  openRead.dispose()

  const readChunk = context.newFunction(
    HOST_FS_READ_CHUNK_KEY,
    (idHandle, sizeHandle) => {
      const id = context.getNumber(idHandle)
      const state = reads.get(id)
      if (!state) {
        return context.null
      }
      const size =
        context.typeof(sizeHandle) === 'number'
          ? Math.max(1, Math.floor(context.getNumber(sizeHandle)))
          : 16 * 1024
      if (state.offset >= state.bytes.byteLength) {
        return context.null
      }
      const end = Math.min(state.bytes.byteLength, state.offset + size)
      const chunk = state.bytes.subarray(state.offset, end)
      state.offset = end
      return hostBytesToGuestBuffer(context, chunk)
    },
  )
  context.setProp(context.global, HOST_FS_READ_CHUNK_KEY, readChunk)
  readChunk.dispose()

  const closeRead = context.newFunction(HOST_FS_CLOSE_READ_KEY, (idHandle) => {
    reads.delete(context.getNumber(idHandle))
    return context.undefined
  })
  context.setProp(context.global, HOST_FS_CLOSE_READ_KEY, closeRead)
  closeRead.dispose()

  const openWrite = context.newFunction(HOST_FS_OPEN_WRITE_KEY, (pathHandle) =>
    runHostPromise(async () => {
      const raw = dumpPrimitive(context, pathHandle)
      await fsHostWriteFile(ops, raw, new Uint8Array(0))
      const absolute = resolveGuestFsPath(raw, ops.getCwd)
      const id = nextId++
      writes.set(id, { path: absolute, written: 0, chunks: [] })
      return context.newNumber(id)
    }),
  )
  context.setProp(context.global, HOST_FS_OPEN_WRITE_KEY, openWrite)
  openWrite.dispose()

  const writeChunk = context.newFunction(HOST_FS_WRITE_CHUNK_KEY, (idHandle, dataHandle) => {
    const id = context.getNumber(idHandle)
    const bytes = readGuestBytes(context, dataHandle)
    const state = writes.get(id)
    if (!state) {
      throw new QuickJsFsError('EBADF', 'WriteStream closed')
    }
    const next = state.written + bytes.byteLength
    if (next > ops.maxFileBytes) {
      throw new QuickJsFsError(
        'ERR_FS_FILE_TOO_LARGE',
        `WriteStream exceeds maxFileBytes (${ops.maxFileBytes})`,
        { path: state.path, syscall: 'write' },
      )
    }
    if (bytes.byteLength > 0) {
      state.chunks.push(bytes.slice())
      state.written = next
    }
    return context.undefined
  })
  context.setProp(context.global, HOST_FS_WRITE_CHUNK_KEY, writeChunk)
  writeChunk.dispose()

  const closeWrite = context.newFunction(HOST_FS_CLOSE_WRITE_KEY, (idHandle) =>
    runHostPromise(async () => {
      const id = context.getNumber(idHandle)
      const state = writes.get(id)
      if (!state) {
        return context.undefined
      }
      writes.delete(id)
      if (state.written > 0) {
        const merged = new Uint8Array(state.written)
        let offset = 0
        for (const chunk of state.chunks) {
          merged.set(chunk, offset)
          offset += chunk.byteLength
        }
        await fsHostWriteFile(ops, state.path, merged)
      }
      return context.undefined
    }),
  )
  context.setProp(context.global, HOST_FS_CLOSE_WRITE_KEY, closeWrite)
  closeWrite.dispose()

  const readableCtor = context.getProp(streamHandle, 'Readable')
  const writableCtor = context.getProp(streamHandle, 'Writable')
  context.setProp(context.global, FS_STREAM_READABLE_KEY, readableCtor)
  context.setProp(context.global, FS_STREAM_WRITABLE_KEY, writableCtor)
  readableCtor.dispose()
  writableCtor.dispose()

  const guestSource = `(function () {
  'use strict';
  var Readable = globalThis.${FS_STREAM_READABLE_KEY};
  var Writable = globalThis.${FS_STREAM_WRITABLE_KEY};

  function inherits(ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, enumerable: false, writable: true, configurable: true },
    });
  }

  function ReadStream(path, options) {
    options = options || {};
    Readable.call(this, options);
    this.path = path;
    this._sid = null;
    this._opening = true;
    this._pending = false;
    var self = this;
    Promise.resolve(globalThis.${HOST_FS_OPEN_READ_KEY}(path)).then(function (id) {
      self._sid = id;
      self._opening = false;
      self._read(self._readableState.highWaterMark);
    }, function (err) {
      self._opening = false;
      self.destroy(err);
    });
  }
  inherits(ReadStream, Readable);
  ReadStream.prototype._read = function _read(size) {
    if (this._opening || this._pending || this._sid == null) return;
    this._pending = true;
    try {
      var chunk = globalThis.${HOST_FS_READ_CHUNK_KEY}(this._sid, size || 16384);
      this._pending = false;
      if (chunk == null) {
        globalThis.${HOST_FS_CLOSE_READ_KEY}(this._sid);
        this._sid = null;
        this.push(null);
        return;
      }
      var ok = this.push(chunk);
      if (ok !== false && !this._readableState.ended) {
        var t = this;
        globalThis.setTimeout(function () {
          t._read(size);
        }, 0);
      }
    } catch (err) {
      this._pending = false;
      this.destroy(err);
    }
  };
  ReadStream.prototype.destroy = function destroy(err) {
    if (this._sid != null) {
      globalThis.${HOST_FS_CLOSE_READ_KEY}(this._sid);
      this._sid = null;
    }
    return Readable.prototype.destroy.call(this, err);
  };

  function WriteStream(path, options) {
    options = options || {};
    Writable.call(this, options);
    this.path = path;
    this._sid = null;
    var self = this;
    this._ready = Promise.resolve(globalThis.${HOST_FS_OPEN_WRITE_KEY}(path)).then(function (id) {
      self._sid = id;
    });
  }
  inherits(WriteStream, Writable);
  WriteStream.prototype._write = function _write(chunk, encoding, cb) {
    var self = this;
    var data = chunk;
    if (typeof chunk === 'string') {
      data = Buffer.from(chunk, encoding || 'utf8');
    }
    function run() {
      try {
        globalThis.${HOST_FS_WRITE_CHUNK_KEY}(self._sid, data);
        cb();
      } catch (err) {
        cb(err);
      }
    }
    if (self._sid != null) {
      run();
      return;
    }
    Promise.resolve(this._ready).then(function () {
      run();
    }, cb);
  };
  WriteStream.prototype.end = function end(chunk, encoding, cb) {
    var self = this;
    var userCb =
      typeof chunk === 'function' ? chunk : typeof encoding === 'function' ? encoding : cb;
    if (typeof chunk === 'function') {
      chunk = null;
      encoding = null;
    } else if (typeof encoding === 'function') {
      encoding = null;
    }
    var state = this._writableState;
    state.ending = true;

    function afterDiskFlush(err) {
      if (err) {
        self.emit('error', err);
        if (typeof userCb === 'function') userCb(err);
        return;
      }
      self.writable = false;
      self.writableEnded = true;
      state.ended = true;
      self.emit('finish');
      self.emit('end');
      if (typeof userCb === 'function') userCb();
    }

    function flushToDisk() {
      if (self._sid != null) {
        var sid = self._sid;
        self._sid = null;
        Promise.resolve(globalThis.${HOST_FS_CLOSE_WRITE_KEY}(sid)).then(function () {
          afterDiskFlush();
        }, afterDiskFlush);
        return;
      }
      afterDiskFlush();
    }

    function whenQueueDrained() {
      if (state.writing || state.queue.length > 0) {
        self.once('__writeIdle', whenQueueDrained);
        return;
      }
      flushToDisk();
    }

    if (chunk != null && chunk !== '') {
      this.write(chunk, encoding, function (err) {
        if (err) {
          if (typeof userCb === 'function') userCb(err);
          return;
        }
        whenQueueDrained();
      });
    } else {
      this._writeNext();
      whenQueueDrained();
    }
    return this;
  };

  function createReadStream(path, options) {
    return new ReadStream(path, options);
  }
  function createWriteStream(path, options) {
    return new WriteStream(path, options);
  }

  globalThis.${FS_STREAM_BUNDLE_KEY} = {
    createReadStream: createReadStream,
    createWriteStream: createWriteStream,
    ReadStream: ReadStream,
    WriteStream: WriteStream,
  };
})();`

  const boot = context.evalCode(guestSource, 'instant-fs-streams.js')
  context.setProp(context.global, FS_STREAM_READABLE_KEY, context.undefined)
  context.setProp(context.global, FS_STREAM_WRITABLE_KEY, context.undefined)
  if (boot.error) {
    const message = (() => {
      try {
        return String(context.dump(boot.error))
      } catch {
        return 'fs streams guest eval failed'
      } finally {
        boot.error.dispose()
      }
    })()
    throw new Error(`Failed to inject fs streams: ${message}`)
  }
  boot.value.dispose()

  const bundle = context.getProp(context.global, FS_STREAM_BUNDLE_KEY)
  for (const key of ['createReadStream', 'createWriteStream', 'ReadStream', 'WriteStream'] as const) {
    const h = context.getProp(bundle, key)
    context.setProp(fsObject, key, h)
    h.dispose()
  }
  context.setProp(context.global, FS_STREAM_BUNDLE_KEY, context.undefined)
  bundle.dispose()
}

/**
 * 注入 fs / fs.promises（回调 + Promise + Asyncify Sync），返回 module handles。
 *
 * Sync（`newAsyncifiedFunction`）：guest 外观阻塞，宿主仍异步打 VFS；同调用栈勿再挂起。
 * 新脚本/宿主桥优先 `fs.promises`（或回调）；`*Sync` 仅为 Node 兼容。
 * 预加载 / 内存工作区属 VFS 或上层性能，不在本模块。
 */
export function injectFs(options: InjectFsOptions): {
  fsHandle: QuickJSHandle
  promisesHandle: QuickJSHandle
  disposeFsWatchers: () => void
} {
  const { context, asyncBridge, ops } = options

  const runAsync = <T>(
    work: () => Promise<T>,
    encode: (context: QuickJSAsyncContext, value: T) => QuickJSHandle | undefined,
  ): QuickJSHandle => {
    const deferred = asyncBridge.createDeferredPromise()
    void (async () => {
      try {
        if (ops.isDestroyed()) {
          throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed')
        }
        const value = await work()
        if (ops.isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          return
        }
        const encoded = encode(context, value)
        asyncBridge.settleGuestPromise(deferred, {
          ok: true,
          value: encoded ?? context.undefined,
        })
      } catch (error) {
        if (ops.isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          return
        }
        const errHandle = createGuestFsError(context, error)
        asyncBridge.settleGuestPromise(deferred, { ok: false, error: errHandle })
      }
    })()
    return deferred.handle
  }

  const callCallback = (
    callback: QuickJSHandle,
    err: QuickJSHandle | undefined,
    value: QuickJSHandle | undefined,
  ) => {
    try {
      const undefinedHandle = context.undefined
      const result = context.callFunction(
        callback,
        context.undefined,
        err ?? undefinedHandle,
        value ?? undefinedHandle,
      )
      if (result.error) {
        result.error.dispose()
      } else {
        result.value.dispose()
      }
    } catch {
      // ignore callback failures
    }
  }

  const runCallback = <T>(
    callback: QuickJSHandle,
    work: () => Promise<T>,
    encode: (context: QuickJSAsyncContext, value: T) => QuickJSHandle | undefined,
  ): void => {
    void (async () => {
      try {
        if (ops.isDestroyed()) {
          return
        }
        const value = await work()
        if (ops.isDestroyed()) {
          return
        }
        const encoded = encode(context, value)
        callCallback(callback, undefined, encoded)
        encoded?.dispose()
        asyncBridge.enqueueHostTask(() => {
          if (!ops.isDestroyed()) {
            asyncBridge.drainAfterSync()
          }
        })
      } catch (error) {
        if (ops.isDestroyed()) {
          return
        }
        const errHandle = createGuestFsError(context, error)
        callCallback(callback, errHandle, undefined)
        errHandle.dispose()
        asyncBridge.enqueueHostTask(() => {
          if (!ops.isDestroyed()) {
            asyncBridge.drainAfterSync()
          }
        })
      }
    })()
  }

  const promises = context.newObject()
  const fsObject = context.newObject()
  const activeWatchCleanups = new Set<() => void>()
  const watchFileEntries = new Map<string, () => void>()
  let fsInjectDisposed = false

  const disposeFsWatchers = () => {
    if (fsInjectDisposed) {
      return
    }
    fsInjectDisposed = true
    for (const cleanup of [...activeWatchCleanups]) {
      cleanup()
    }
    activeWatchCleanups.clear()
    watchFileEntries.clear()
  }

  injectFsConstants(context, fsObject)

  // ---- promises API ----
  const bindPromise = <T>(
    name: string,
    work: (args: QuickJSHandle[]) => Promise<T>,
    encode: (context: QuickJSAsyncContext, value: T) => QuickJSHandle | undefined,
  ) => {
    const fn = context.newFunction(name, (...argHandles) =>
      runAsync(() => work(argHandles), encode),
    )
    context.setProp(promises, name, fn)
    fn.dispose()
  }

  bindPromise(
    'readFile',
    async (args) => {
      const encoding = args.length >= 2 ? normalizeEncoding(dumpPrimitive(context, args[1]!)) : 'buffer'
      return fsHostReadFile(ops, dumpPrimitive(context, args[0]!), encoding)
    },
    encodeReadResult,
  )

  bindPromise(
    'writeFile',
    async (args) => {
      await fsHostWriteFile(ops, dumpPrimitive(context, args[0]!), parseWriteData(context, args[1]!))
    },
    encodeVoid,
  )

  bindPromise(
    'appendFile',
    async (args) => {
      await fsHostAppendFile(ops, dumpPrimitive(context, args[0]!), parseWriteData(context, args[1]!))
    },
    encodeVoid,
  )

  bindPromise(
    'mkdir',
    async (args) => {
      const opts =
        args.length >= 2 && context.typeof(args[1]!) === 'object'
          ? (dumpPrimitive(context, args[1]!) as { recursive?: boolean })
          : undefined
      return fsHostMkdir(ops, dumpPrimitive(context, args[0]!), opts)
    },
    encodeMkdirResult,
  )

  bindPromise(
    'readdir',
    async (args) => {
      const opts =
        args.length >= 2 && context.typeof(args[1]!) === 'object'
          ? (dumpPrimitive(context, args[1]!) as { withFileTypes?: boolean })
          : undefined
      return fsHostReaddir(ops, dumpPrimitive(context, args[0]!), opts)
    },
    encodeReaddirResult,
  )

  bindPromise(
    'realpath',
    async (args) => fsHostRealpath(ops, dumpPrimitive(context, args[0]!)),
    encodeMkdirResult,
  )

  bindPromise(
    'copyFile',
    async (args) => {
      const mode =
        args.length >= 3 && context.typeof(args[2]!) === 'number'
          ? context.getNumber(args[2]!)
          : undefined
      await fsHostCopyFile(
        ops,
        dumpPrimitive(context, args[0]!),
        dumpPrimitive(context, args[1]!),
        mode,
      )
    },
    encodeVoid,
  )

  bindPromise(
    'mkdtemp',
    async (args) => fsHostMkdtemp(ops, dumpPrimitive(context, args[0]!)),
    encodeMkdirResult,
  )

  bindPromise(
    'truncate',
    async (args) => {
      const len =
        args.length >= 2 && context.typeof(args[1]!) === 'number'
          ? context.getNumber(args[1]!)
          : 0
      await fsHostTruncate(ops, dumpPrimitive(context, args[0]!), len)
    },
    encodeVoid,
  )

  bindPromise(
    'chmod',
    async (args) => {
      await fsHostChmod(ops, dumpPrimitive(context, args[0]!))
    },
    encodeVoid,
  )

  bindPromise(
    'chown',
    async (args) => {
      await fsHostChown(ops, dumpPrimitive(context, args[0]!))
    },
    encodeVoid,
  )

  bindPromise(
    'stat',
    async (args) => fsHostStat(ops, dumpPrimitive(context, args[0]!)),
    hostStatsToGuest,
  )

  bindPromise(
    'lstat',
    async (args) => fsHostLstat(ops, dumpPrimitive(context, args[0]!)),
    hostStatsToGuest,
  )

  bindPromise(
    'symlink',
    async (args) => {
      await fsHostSymlink(ops, dumpPrimitive(context, args[0]!), dumpPrimitive(context, args[1]!))
    },
    encodeVoid,
  )

  bindPromise(
    'readlink',
    async (args) => fsHostReadlink(ops, dumpPrimitive(context, args[0]!)),
    encodeMkdirResult,
  )

  bindPromise(
    'rename',
    async (args) => {
      await fsHostRename(ops, dumpPrimitive(context, args[0]!), dumpPrimitive(context, args[1]!))
    },
    encodeVoid,
  )

  bindPromise(
    'unlink',
    async (args) => {
      await fsHostUnlink(ops, dumpPrimitive(context, args[0]!))
    },
    encodeVoid,
  )

  bindPromise(
    'rm',
    async (args) => {
      const opts =
        args.length >= 2 && context.typeof(args[1]!) === 'object'
          ? (dumpPrimitive(context, args[1]!) as { recursive?: boolean; force?: boolean })
          : undefined
      await fsHostRm(ops, dumpPrimitive(context, args[0]!), opts)
    },
    encodeVoid,
  )

  bindPromise(
    'rmdir',
    async (args) => {
      await fsHostRmdir(ops, dumpPrimitive(context, args[0]!))
    },
    encodeVoid,
  )

  bindPromise(
    'access',
    async (args) => {
      await fsHostAccess(ops, dumpPrimitive(context, args[0]!))
    },
    encodeVoid,
  )

  // ---- callback + sync helpers ----
  const bindCallbackAndSync = <T>(
    name: string,
    syncName: string,
    parseArgs: (args: QuickJSHandle[]) => {
      callback?: QuickJSHandle
      work: () => Promise<T>
    },
    encode: (context: QuickJSAsyncContext, value: T) => QuickJSHandle | undefined,
  ) => {
    const cbFn = context.newFunction(name, (...argHandles) => {
      const parsed = parseArgs(argHandles)
      if (parsed.callback !== undefined) {
        runCallback(parsed.callback, parsed.work, encode)
        return context.undefined
      }
      return runAsync(parsed.work, encode)
    })
    context.setProp(fsObject, name, cbFn)
    cbFn.dispose()

    // Asyncify Sync：挂起等 VFS；此栈内禁止再进可挂起桥（含再 Sync / 可挂起 import）
    const syncFn = context.newAsyncifiedFunction(syncName, async (...argHandles) => {
      try {
        const parsed = parseArgs(argHandles)
        const value = await parsed.work()
        const encoded = encode(context, value)
        return encoded ?? context.undefined
      } catch (error) {
        return context['fail'](createGuestFsError(context, error))
      }
    })
    context.setProp(fsObject, syncName, syncFn)
    syncFn.dispose()
  }

  bindCallbackAndSync(
    'readFile',
    'readFileSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      const callback = hasCb ? last : undefined
      const pathArg = args[0]!
      const encArg = hasCb
        ? args.length >= 3
          ? args[1]
          : undefined
        : args.length >= 2
          ? args[1]
          : undefined
      const encoding = encArg ? normalizeEncoding(dumpPrimitive(context, encArg)) : 'buffer'
      return {
        callback,
        work: () => fsHostReadFile(ops, dumpPrimitive(context, pathArg), encoding),
      }
    },
    encodeReadResult,
  )

  bindCallbackAndSync(
    'writeFile',
    'writeFileSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      const callback = hasCb ? last : undefined
      return {
        callback,
        work: async () => {
          await fsHostWriteFile(
            ops,
            dumpPrimitive(context, args[0]!),
            parseWriteData(context, args[1]!),
          )
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'appendFile',
    'appendFileSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostAppendFile(
            ops,
            dumpPrimitive(context, args[0]!),
            parseWriteData(context, args[1]!),
          )
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'mkdir',
    'mkdirSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      const optsHandle = hasCb
        ? args.length >= 3
          ? args[1]
          : undefined
        : args.length >= 2 && context.typeof(args[1]!) === 'object'
          ? args[1]
          : undefined
      const opts = optsHandle
        ? (dumpPrimitive(context, optsHandle) as { recursive?: boolean })
        : undefined
      return {
        callback: hasCb ? last : undefined,
        work: () => fsHostMkdir(ops, dumpPrimitive(context, args[0]!), opts),
      }
    },
    encodeMkdirResult,
  )

  bindCallbackAndSync(
    'readdir',
    'readdirSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      const opts = parseReaddirOptions(context, args, hasCb)
      return {
        callback: hasCb ? last : undefined,
        work: () => fsHostReaddir(ops, dumpPrimitive(context, args[0]!), opts),
      }
    },
    encodeReaddirResult,
  )

  bindCallbackAndSync(
    'realpath',
    'realpathSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: () => fsHostRealpath(ops, dumpPrimitive(context, args[0]!)),
      }
    },
    encodeMkdirResult,
  )

  const realpathSyncHandle = context.getProp(fsObject, 'realpathSync')
  const realpathNativeFn = context.newAsyncifiedFunction('native', async (pathHandle) => {
    try {
      const value = await fsHostRealpath(ops, dumpPrimitive(context, pathHandle))
      return context.newString(value)
    } catch (error) {
      return context['fail'](createGuestFsError(context, error))
    }
  })
  context.setProp(realpathSyncHandle, 'native', realpathNativeFn)
  realpathNativeFn.dispose()
  realpathSyncHandle.dispose()

  bindCallbackAndSync(
    'copyFile',
    'copyFileSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      const modeArg = hasCb
        ? args.length >= 4
          ? args[2]
          : undefined
        : args.length >= 3
          ? args[2]
          : undefined
      const mode =
        modeArg !== undefined && context.typeof(modeArg) === 'number'
          ? context.getNumber(modeArg)
          : undefined
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostCopyFile(
            ops,
            dumpPrimitive(context, args[0]!),
            dumpPrimitive(context, args[1]!),
            mode,
          )
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'mkdtemp',
    'mkdtempSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: () => fsHostMkdtemp(ops, dumpPrimitive(context, args[0]!)),
      }
    },
    encodeMkdirResult,
  )

  bindCallbackAndSync(
    'truncate',
    'truncateSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      const lenArg = hasCb
        ? args.length >= 3
          ? args[1]
          : undefined
        : args.length >= 2
          ? args[1]
          : undefined
      const len =
        lenArg !== undefined && context.typeof(lenArg) === 'number' ? context.getNumber(lenArg) : 0
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostTruncate(ops, dumpPrimitive(context, args[0]!), len)
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'chmod',
    'chmodSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostChmod(ops, dumpPrimitive(context, args[0]!))
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'chown',
    'chownSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostChown(ops, dumpPrimitive(context, args[0]!))
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'stat',
    'statSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: () => fsHostStat(ops, dumpPrimitive(context, args[0]!)),
      }
    },
    hostStatsToGuest,
  )

  bindCallbackAndSync(
    'lstat',
    'lstatSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: () => fsHostLstat(ops, dumpPrimitive(context, args[0]!)),
      }
    },
    hostStatsToGuest,
  )

  bindCallbackAndSync(
    'symlink',
    'symlinkSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostSymlink(
            ops,
            dumpPrimitive(context, args[0]!),
            dumpPrimitive(context, args[1]!),
          )
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'readlink',
    'readlinkSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: () => fsHostReadlink(ops, dumpPrimitive(context, args[0]!)),
      }
    },
    encodeMkdirResult,
  )

  bindCallbackAndSync(
    'rename',
    'renameSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostRename(
            ops,
            dumpPrimitive(context, args[0]!),
            dumpPrimitive(context, args[1]!),
          )
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'unlink',
    'unlinkSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostUnlink(ops, dumpPrimitive(context, args[0]!))
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'rm',
    'rmSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      const optsHandle = hasCb
        ? args.length >= 3
          ? args[1]
          : undefined
        : args.length >= 2
          ? args[1]
          : undefined
      const opts = optsHandle
        ? (dumpPrimitive(context, optsHandle) as { recursive?: boolean; force?: boolean })
        : undefined
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostRm(ops, dumpPrimitive(context, args[0]!), opts)
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'rmdir',
    'rmdirSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostRmdir(ops, dumpPrimitive(context, args[0]!))
        },
      }
    },
    encodeVoid,
  )

  bindCallbackAndSync(
    'access',
    'accessSync',
    (args) => {
      const last = args[args.length - 1]
      const hasCb = isGuestFunction(context, last)
      return {
        callback: hasCb ? last : undefined,
        work: async () => {
          await fsHostAccess(ops, dumpPrimitive(context, args[0]!))
        },
      }
    },
    encodeVoid,
  )

  const pathForWatch = () => createPosixPathApi(ops.getCwd)

  const emitWatchEvent = (
    listener: QuickJSHandle,
    watcher: QuickJSHandle,
    event: 'rename' | 'change',
    filename: string,
  ) => {
    if (ops.isDestroyed() || fsInjectDisposed) {
      return
    }
    const eventHandle = context.newString(event)
    const fileHandle = context.newString(filename)
    try {
      const result = context.callFunction(listener, watcher, eventHandle, fileHandle)
      if (result.error) {
        result.error.dispose()
      } else {
        result.value.dispose()
      }
    } catch {
      // instance 已销毁时忽略迟到的 watch 回调
    } finally {
      eventHandle.dispose()
      fileHandle.dispose()
    }
  }

  const watchFn = context.newFunction('watch', (...argHandles) => {
    const pathRaw = dumpPrimitive(context, argHandles[0]!)
    let options: { recursive?: boolean } | undefined
    let listener: QuickJSHandle | undefined
    if (argHandles.length >= 2) {
      if (isGuestFunction(context, argHandles[1])) {
        listener = argHandles[1]
      } else if (context.typeof(argHandles[1]!) === 'object') {
        options = dumpPrimitive(context, argHandles[1]!) as { recursive?: boolean }
        if (argHandles.length >= 3 && isGuestFunction(context, argHandles[2])) {
          listener = argHandles[2]
        }
      }
    }

    const watcher = context.newObject()
    let closed = false
    let unsub: (() => void) | undefined

    const cleanup = () => {
      if (closed) {
        return
      }
      closed = true
      unsub?.()
      activeWatchCleanups.delete(cleanup)
    }
    activeWatchCleanups.add(cleanup)

    const closeFn = context.newFunction('close', () => {
      cleanup()
      return context.undefined
    })
    context.setProp(watcher, 'close', closeFn)
    closeFn.dispose()

    try {
      const absolute = resolveGuestFsPath(pathRaw, ops.getCwd)
      unsub = filesWatch(
        absolute,
        (change) => {
          if (closed || ops.isDestroyed() || fsInjectDisposed || listener === undefined) {
            return
          }
          const event = mapFilesWatchEvent(change)
          const filename = pathForWatch().basename(change.path)
          emitWatchEvent(listener, watcher, event, filename)
        },
        { recursive: options?.recursive !== false },
      )
    } catch {
      cleanup()
    }

    return watcher
  })
  context.setProp(fsObject, 'watch', watchFn)
  watchFn.dispose()

  const watchFileFn = context.newFunction('watchFile', (...argHandles) => {
    let listener: QuickJSHandle | undefined
    if (argHandles.length >= 2 && isGuestFunction(context, argHandles[1])) {
      listener = argHandles[1]
    } else if (argHandles.length >= 3 && isGuestFunction(context, argHandles[2])) {
      listener = argHandles[2]
    }
    if (listener === undefined) {
      return context.undefined
    }

    const absolute = resolveGuestFsPath(dumpPrimitive(context, argHandles[0]!), ops.getCwd)
    watchFileEntries.get(absolute)?.()

    let closed = false
    let unsub: (() => void) | undefined
    const cleanup = () => {
      if (closed) {
        return
      }
      closed = true
      unsub?.()
      watchFileEntries.delete(absolute)
      activeWatchCleanups.delete(cleanup)
    }
    activeWatchCleanups.add(cleanup)
    watchFileEntries.set(absolute, cleanup)

    try {
      unsub = filesWatch(
        absolute,
        () => {
          if (closed || ops.isDestroyed() || fsInjectDisposed) {
            return
          }
          void (async () => {
            try {
              const stats = await fsHostStat(ops, absolute)
              if (closed || ops.isDestroyed()) {
                return
              }
              const statHandle = hostStatsToGuest(context, stats)
              const result = context.callFunction(
                listener!,
                context.undefined,
                statHandle,
                statHandle,
              )
              statHandle.dispose()
              if (result.error) {
                result.error.dispose()
              } else {
                result.value.dispose()
              }
            } catch {
              // ignore stat failures during watch
            }
          })()
        },
        { recursive: false },
      )
    } catch {
      cleanup()
    }

    return context.undefined
  })
  context.setProp(fsObject, 'watchFile', watchFileFn)
  watchFileFn.dispose()

  const unwatchFileFn = context.newFunction('unwatchFile', (pathHandle) => {
    const absolute = resolveGuestFsPath(dumpPrimitive(context, pathHandle), ops.getCwd)
    watchFileEntries.get(absolute)?.()
    return context.undefined
  })
  context.setProp(fsObject, 'unwatchFile', unwatchFileFn)
  unwatchFileFn.dispose()

  // exists / existsSync（Node 已弃用但常用）
  const existsCb = context.newFunction('exists', (pathHandle, cbHandle) => {
    if (isGuestFunction(context, cbHandle)) {
      void (async () => {
        try {
          const ok = await fsHostExists(ops, dumpPrimitive(context, pathHandle))
          if (ops.isDestroyed()) return
          const result = context.callFunction(
            cbHandle!,
            context.undefined,
            ok ? context.true : context.false,
          )
          if (result.error) result.error.dispose()
          else result.value.dispose()
        } catch {
          if (ops.isDestroyed()) return
          const result = context.callFunction(cbHandle!, context.undefined, context.false)
          if (result.error) result.error.dispose()
          else result.value.dispose()
        }
      })()
      return context.undefined
    }
    return runAsync(async () => fsHostExists(ops, dumpPrimitive(context, pathHandle)), (ctx, v) =>
      v ? ctx.true : ctx.false,
    )
  })
  context.setProp(fsObject, 'exists', existsCb)
  existsCb.dispose()

  const existsSync = context.newAsyncifiedFunction('existsSync', async (pathHandle) => {
    try {
      const ok = await fsHostExists(ops, dumpPrimitive(context, pathHandle))
      return ok ? context.true : context.false
    } catch (error) {
      return context['fail'](createGuestFsError(context, error))
    }
  })
  context.setProp(fsObject, 'existsSync', existsSync)
  existsSync.dispose()

  // ---- streaming createReadStream / createWriteStream ----
  if (options.streamHandle !== undefined) {
    injectFsStreams({
      context,
      asyncBridge,
      ops,
      fsObject,
      streamHandle: options.streamHandle,
    })
  }

  context.setProp(fsObject, 'promises', promises)

  return { fsHandle: fsObject, promisesHandle: promises, disposeFsWatchers }
}

export function buildFsModuleSource(builtinsGlobalKey: string): string {
  const keys = [
    'readFile',
    'readFileSync',
    'writeFile',
    'writeFileSync',
    'appendFile',
    'appendFileSync',
    'mkdir',
    'mkdirSync',
    'readdir',
    'readdirSync',
    'stat',
    'statSync',
    'lstat',
    'lstatSync',
    'symlink',
    'symlinkSync',
    'readlink',
    'readlinkSync',
    'rename',
    'renameSync',
    'unlink',
    'unlinkSync',
    'rm',
    'rmSync',
    'rmdir',
    'rmdirSync',
    'access',
    'accessSync',
    'realpath',
    'realpathSync',
    'copyFile',
    'copyFileSync',
    'mkdtemp',
    'mkdtempSync',
    'truncate',
    'truncateSync',
    'chmod',
    'chmodSync',
    'chown',
    'chownSync',
    'watch',
    'watchFile',
    'unwatchFile',
    'constants',
    'exists',
    'existsSync',
    'createReadStream',
    'createWriteStream',
    'ReadStream',
    'WriteStream',
    'promises',
  ]
  const named = keys.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return `const __m = globalThis.${builtinsGlobalKey}.fs;\n${named}\nexport default __m;\n`
}

export function buildFsPromisesModuleSource(builtinsGlobalKey: string): string {
  const keys = [
    'readFile',
    'writeFile',
    'appendFile',
    'mkdir',
    'readdir',
    'stat',
    'lstat',
    'symlink',
    'readlink',
    'rename',
    'unlink',
    'rm',
    'rmdir',
    'access',
    'realpath',
    'copyFile',
    'mkdtemp',
    'truncate',
    'chmod',
    'chown',
  ]
  const named = keys.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return `const __m = globalThis.${builtinsGlobalKey}['fs/promises'];\n${named}\nexport default __m;\n`
}
