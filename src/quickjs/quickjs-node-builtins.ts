import type {
  QuickJSAsyncContext,
  QuickJSAsyncRuntime,
  QuickJSContext,
  QuickJSHandle,
} from 'quickjs-emscripten'
import type { QuickJsAsyncBridge } from './quickjs-async-bridge.ts'
import { buildBufferModuleSource, injectBuffer } from './quickjs-buffer.ts'
import { buildEventsModuleSource, injectEvents } from './quickjs-events.ts'
import {
  buildFsModuleSource,
  buildFsPromisesModuleSource,
  injectFs,
} from './quickjs-fs.ts'
import type { QuickJsFsHostOps } from './quickjs-fs-vfs.ts'
import {
  createCjsRequireApi,
  createModuleErrorHandle,
} from './quickjs-cjs-require.ts'
import {
  loadEsmModuleSourceFromVfs,
  normalizeModuleRequest,
  resolveBareSpecifierAsync,
  tryDecodeBareModuleName,
} from './quickjs-module-loader.ts'
import { createPosixPathApi, type QuickJsPathApi } from './quickjs-path.ts'

/** 实例私有：内建模块对象挂载点（非公开脚本 API）。 */
const BUILTINS_GLOBAL_KEY = '__instantNodeBuiltins'

/**
 * 常见 Node 内建名（未实现时用于更清晰的报错）。
 * 不是完整 builtinModules 列表；随 Instant 实现进度可增补。
 */
const KNOWN_NODE_BUILTIN_IDS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
])

const PATH_EXPORT_KEYS = [
  'sep',
  'delimiter',
  'basename',
  'dirname',
  'extname',
  'format',
  'isAbsolute',
  'join',
  'normalize',
  'parse',
  'relative',
  'resolve',
  'posix',
] as const

export type QuickJsNodeBuiltinRegistry = {
  listImplemented: () => string[]
}

function normalizeModuleId(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('node:')) {
    return trimmed.slice('node:'.length)
  }
  return trimmed
}

function toCanonicalBuiltinId(raw: string): string {
  const id = normalizeModuleId(raw)
  if (id === 'path/posix') {
    return 'path'
  }
  return id
}

function formatMissingBuiltinError(requested: string, implemented: string[]): Error {
  const id = normalizeModuleId(requested)
  const implementedHint =
    implemented.length > 0 ? implemented.map((name) => `'${name}'`).join(', ') : '(none)'

  if (KNOWN_NODE_BUILTIN_IDS.has(id) || requested.trim().startsWith('node:')) {
    return new Error(
      `Cannot find module '${requested}'. Instant Node builtin '${id}' is not implemented yet. Implemented: ${implementedHint}`,
    )
  }

  return new Error(
    `Cannot find module '${requested}'. Bare package name not found in node_modules (or not installed). Instant require loads relative/absolute files, node_modules packages, and implemented Node builtins. Implemented builtins: ${implementedHint}`,
  )
}

function builtinModuleSource(canonical: string): string | undefined {
  if (canonical === 'path') {
    return PATH_MODULE_SOURCE
  }
  if (canonical === 'buffer') {
    return BUFFER_MODULE_SOURCE
  }
  if (canonical === 'events') {
    return EVENTS_MODULE_SOURCE
  }
  if (canonical === 'fs') {
    return FS_MODULE_SOURCE
  }
  if (canonical === 'fs/promises') {
    return FS_PROMISES_MODULE_SOURCE
  }
  return undefined
}

function dumpArgString(context: QuickJSContext, handle: QuickJSHandle): string {
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

function dumpArgStrings(context: QuickJSContext, handles: QuickJSHandle[]): string[] {
  return handles.map((handle) => dumpArgString(context, handle))
}

function injectJsonProp(context: QuickJSContext, target: QuickJSHandle, key: string, value: unknown): void {
  const handle = context.unwrapResult(context.evalCode(`(${JSON.stringify(value)})`))
  context.setProp(target, key, handle)
  handle.dispose()
}

function createPathModuleHandle(context: QuickJSContext, api: QuickJsPathApi): QuickJSHandle {
  const pathObject = context.newObject()

  injectJsonProp(context, pathObject, 'sep', api.sep)
  injectJsonProp(context, pathObject, 'delimiter', api.delimiter)

  const bindFn = (name: string, fn: (...args: string[]) => unknown) => {
    const handle = context.newFunction(name, (...argHandles) => {
      try {
        const result = fn(...dumpArgStrings(context, argHandles))
        if (typeof result === 'string') {
          return context.newString(result)
        }
        if (typeof result === 'boolean') {
          return result ? context.true : context.false
        }
        if (typeof result === 'number') {
          return context.newNumber(result)
        }
        return context.unwrapResult(context.evalCode(`(${JSON.stringify(result)})`))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(message)
      }
    })
    context.setProp(pathObject, name, handle)
    handle.dispose()
  }

  bindFn('basename', (path, suffix) =>
    suffix === undefined ? api.basename(path) : api.basename(path, suffix),
  )
  bindFn('dirname', (path) => api.dirname(path))
  bindFn('extname', (path) => api.extname(path))
  bindFn('isAbsolute', (path) => api.isAbsolute(path))
  bindFn('join', (...paths) => api.join(...paths))
  bindFn('normalize', (path) => api.normalize(path))
  bindFn('relative', (from, to) => api.relative(from, to))
  bindFn('resolve', (...paths) => api.resolve(...paths))

  const parseFn = context.newFunction('parse', (pathHandle) => {
    const parsed = api.parse(dumpArgString(context, pathHandle))
    return context.unwrapResult(context.evalCode(`(${JSON.stringify(parsed)})`))
  })
  context.setProp(pathObject, 'parse', parseFn)
  parseFn.dispose()

  const formatFn = context.newFunction('format', (objectHandle) => {
    let pathObjectArg: Partial<{
      root: string
      dir: string
      base: string
      ext: string
      name: string
    }>
    try {
      pathObjectArg = context.dump(objectHandle) as typeof pathObjectArg
    } catch {
      throw new TypeError('The "pathObject" argument must be of type object')
    }
    return context.newString(api.format(pathObjectArg ?? {}))
  })
  context.setProp(pathObject, 'format', formatFn)
  formatFn.dispose()

  context.setProp(pathObject, 'posix', pathObject)
  return pathObject
}

function buildPathModuleSource(): string {
  const named = PATH_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return `const __m = globalThis.${BUILTINS_GLOBAL_KEY}.path;\n${named}\nexport default __m;\n`
}

const PATH_MODULE_SOURCE = buildPathModuleSource()
const BUFFER_MODULE_SOURCE = buildBufferModuleSource(BUILTINS_GLOBAL_KEY)
const EVENTS_MODULE_SOURCE = buildEventsModuleSource(BUILTINS_GLOBAL_KEY)
const FS_MODULE_SOURCE = buildFsModuleSource(BUILTINS_GLOBAL_KEY)
const FS_PROMISES_MODULE_SOURCE = buildFsPromisesModuleSource(BUILTINS_GLOBAL_KEY)

function lookupBuiltinHandle(
  context: QuickJSContext,
  canonicalId: string,
): QuickJSHandle | undefined {
  const namespace = context.getProp(context.global, BUILTINS_GLOBAL_KEY)
  try {
    if (context.typeof(namespace) !== 'object') {
      return undefined
    }
    const handle = context.getProp(namespace, canonicalId)
    if (context.typeof(handle) === 'undefined') {
      handle.dispose()
      return undefined
    }
    return handle
  } finally {
    namespace.dispose()
  }
}

/**
 * 注入 Node 内建注册表：setModuleLoader（ESM）+ 全局 require（内建 + 文件级 CJS）。
 * 已实现内建：path、buffer、events、fs、fs/promises（及 node: / path/posix 别名）。
 */
export function injectNodeBuiltins(
  runtime: QuickJSAsyncRuntime,
  context: QuickJSAsyncContext,
  options: {
    getCwd: () => string
    asyncBridge: QuickJsAsyncBridge
    fsOps: QuickJsFsHostOps
  },
): QuickJsNodeBuiltinRegistry {
  const implemented = new Set<string>(['path', 'buffer', 'events', 'fs', 'fs/promises'])
  const listImplemented = () => [...implemented]

  const pathApi = createPosixPathApi(options.getCwd)
  const pathHandle = createPathModuleHandle(context, pathApi)
  const bufferHandle = injectBuffer(context)
  const eventsHandle = injectEvents(context)
  const { fsHandle, promisesHandle } = injectFs({
    context,
    asyncBridge: options.asyncBridge,
    ops: options.fsOps,
  })

  const namespace = context.newObject()
  context.setProp(namespace, 'path', pathHandle)
  pathHandle.dispose()
  context.setProp(namespace, 'buffer', bufferHandle)
  bufferHandle.dispose()
  context.setProp(namespace, 'events', eventsHandle)
  eventsHandle.dispose()
  context.setProp(namespace, 'fs', fsHandle)
  context.setProp(namespace, 'fs/promises', promisesHandle)
  fsHandle.dispose()
  promisesHandle.dispose()
  context.setProp(context.global, BUILTINS_GLOBAL_KEY, namespace)
  namespace.dispose()

  const resolveOptions = {
    getCwd: options.getCwd,
    isImplementedBuiltin: (id: string) => implemented.has(id),
    isKnownNodeBuiltin: (id: string) => KNOWN_NODE_BUILTIN_IDS.has(id),
    listImplemented,
    toCanonicalBuiltinId,
  }

  /** normalizer 失败后引擎仍可能以空名调 loader；用此带回真实错误。 */
  let lastModuleNormalizeError: Error | undefined

  runtime.setModuleLoader(
    async (moduleName) => {
      if (!moduleName) {
        const err =
          lastModuleNormalizeError ??
          new Error(
            `Cannot find module ''. Module normalizer failed without a message.`,
          )
        lastModuleNormalizeError = undefined
        return { error: err }
      }
      lastModuleNormalizeError = undefined

      // 已经过 normalizer：内建为 canonical id，文件为绝对路径，裸名为 instant-bare:…
      const bare = tryDecodeBareModuleName(moduleName)
      if (bare) {
        try {
          const absolute = await resolveBareSpecifierAsync(
            bare.baseModuleName,
            bare.requestedName,
            'import',
          )
          return await loadEsmModuleSourceFromVfs(absolute, options.fsOps)
        } catch (error) {
          return {
            error: error instanceof Error ? error : new Error(String(error)),
          }
        }
      }

      if (moduleName.startsWith('/')) {
        try {
          return await loadEsmModuleSourceFromVfs(moduleName, options.fsOps)
        } catch (error) {
          return {
            error: error instanceof Error ? error : new Error(String(error)),
          }
        }
      }

      const canonical = toCanonicalBuiltinId(moduleName)
      if (canonical === 'path/win32') {
        return {
          error: new Error(
            `Cannot find module '${moduleName}'. Instant path is POSIX-only; path/win32 is not supported.`,
          ),
        }
      }
      const source = builtinModuleSource(canonical)
      if (source !== undefined) {
        return source
      }
      return { error: formatMissingBuiltinError(moduleName, listImplemented()) }
    },
    (baseModuleName, requestedName) => {
      try {
        const resolved = normalizeModuleRequest(baseModuleName, requestedName, resolveOptions)
        if (resolved.kind === 'builtin') {
          if (resolved.id === 'path/win32') {
            const error = new Error(
              `Cannot find module '${requestedName}'. Instant path is POSIX-only; path/win32 is not supported.`,
            )
            lastModuleNormalizeError = error
            return { error }
          }
          lastModuleNormalizeError = undefined
          return resolved.id
        }
        lastModuleNormalizeError = undefined
        return resolved.absolutePath
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        lastModuleNormalizeError = err
        return { error: err }
      }
    },
  )

  const cjs = createCjsRequireApi(context, {
    getCwd: options.getCwd,
    fsOps: options.fsOps,
    lookupBuiltin: (canonicalId) => lookupBuiltinHandle(context, canonicalId),
    toCanonicalBuiltinId,
    isImplementedBuiltin: (id) => implemented.has(id),
    isKnownNodeBuiltin: (id) => KNOWN_NODE_BUILTIN_IDS.has(id),
    listImplemented,
    formatMissingModuleError: (requested) =>
      formatMissingBuiltinError(requested, listImplemented()),
  })

  // 顶层 require：Asyncify（宿主递归加载文件，避免嵌套挂起）
  const requireFn = context.newAsyncifiedFunction('require', async (idHandle) => {
    try {
      const requested = dumpArgString(context, idHandle)
      return await cjs.load(requested, cjs.evalParentFilename())
    } catch (error) {
      return context.fail(createModuleErrorHandle(context, error))
    }
  })

  const resolveFn = context.newAsyncifiedFunction('resolve', async (idHandle) => {
    try {
      const requested = dumpArgString(context, idHandle)
      const resolved = await cjs.resolve(requested, cjs.evalParentFilename())
      return context.newString(resolved)
    } catch (error) {
      return context.fail(createModuleErrorHandle(context, error))
    }
  })
  context.setProp(requireFn, 'resolve', resolveFn)
  resolveFn.dispose()

  const cacheHandle = cjs.getRequireCacheHandle()
  context.setProp(requireFn, 'cache', cacheHandle)

  context.setProp(context.global, 'require', requireFn)
  requireFn.dispose()

  return { listImplemented }
}
