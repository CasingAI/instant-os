import type {
  QuickJSAsyncContext,
  QuickJSHandle,
} from 'quickjs-emscripten'
import type { QuickJsAsyncBridge } from './quickjs-async-bridge.ts'
import { QuickJsFsError, isQuickJsFsError, toQuickJsFsError } from './quickjs-fs-errors.ts'
import type { QuickJsFsHostOps, QuickJsFsStats } from './quickjs-fs-vfs.ts'
import {
  fsHostAccess,
  fsHostAppendFile,
  fsHostExists,
  fsHostLstat,
  fsHostMkdir,
  fsHostReadFile,
  fsHostReaddir,
  fsHostReadlink,
  fsHostRename,
  fsHostRm,
  fsHostRmdir,
  fsHostStat,
  fsHostSymlink,
  fsHostUnlink,
  fsHostWriteFile,
} from './quickjs-fs-vfs.ts'

const TMP_AB_KEY = '__instantFsTmpArrayBuffer'

export type InjectFsOptions = {
  context: QuickJSAsyncContext
  asyncBridge: QuickJsAsyncBridge
  ops: QuickJsFsHostOps
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

function isGuestFunction(context: QuickJSAsyncContext, handle: QuickJSHandle | undefined): boolean {
  if (handle === undefined) {
    return false
  }
  return context.typeof(handle) === 'function'
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
          deferred.dispose()
          return
        }
        const encoded = encode(context, value)
        asyncBridge.settleGuestPromise(deferred, {
          ok: true,
          value: encoded ?? context.undefined,
        })
      } catch (error) {
        if (ops.isDestroyed()) {
          if (deferred.alive) {
            deferred.dispose()
          }
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
    async (args) => fsHostReaddir(ops, dumpPrimitive(context, args[0]!)),
    encodeStringArray,
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
        return context.fail(createGuestFsError(context, error))
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
      return {
        callback: hasCb ? last : undefined,
        work: () => fsHostReaddir(ops, dumpPrimitive(context, args[0]!)),
      }
    },
    encodeStringArray,
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
      return context.fail(createGuestFsError(context, error))
    }
  })
  context.setProp(fsObject, 'existsSync', existsSync)
  existsSync.dispose()

  context.setProp(fsObject, 'promises', promises)

  return { fsHandle: fsObject, promisesHandle: promises }
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
    'exists',
    'existsSync',
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
  ]
  const named = keys.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return `const __m = globalThis.${builtinsGlobalKey}['fs/promises'];\n${named}\nexport default __m;\n`
}
