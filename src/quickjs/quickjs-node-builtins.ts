import type { QuickJSContext, QuickJSHandle, QuickJSRuntime } from 'quickjs-emscripten'
import { buildBufferModuleSource, injectBuffer } from './quickjs-buffer.ts'
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

function formatMissingModuleError(requested: string, implemented: string[]): Error {
  const id = normalizeModuleId(requested)
  const implementedHint =
    implemented.length > 0 ? implemented.map((name) => `'${name}'`).join(', ') : '(none)'

  if (KNOWN_NODE_BUILTIN_IDS.has(id) || requested.trim().startsWith('node:')) {
    return new Error(
      `Cannot find module '${requested}'. Instant Node builtin '${id}' is not implemented yet. Implemented: ${implementedHint}`,
    )
  }

  return new Error(
    `Cannot find module '${requested}'. Instant require/import currently only supports implemented Node builtins (not third-party or file paths). Implemented: ${implementedHint}`,
  )
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
 * 注入 Node 内建注册表：setModuleLoader（import）+ 全局 require，同表同对象。
 * 已实现：path、buffer（及 node: 前缀 / path/posix 别名）。
 */
export function injectNodeBuiltins(
  runtime: QuickJSRuntime,
  context: QuickJSContext,
  options: { getCwd: () => string },
): QuickJsNodeBuiltinRegistry {
  const implemented = new Set<string>(['path', 'buffer'])
  const listImplemented = () => [...implemented]

  const pathApi = createPosixPathApi(options.getCwd)
  const pathHandle = createPathModuleHandle(context, pathApi)
  const bufferHandle = injectBuffer(context)

  const namespace = context.newObject()
  context.setProp(namespace, 'path', pathHandle)
  pathHandle.dispose()
  context.setProp(namespace, 'buffer', bufferHandle)
  bufferHandle.dispose()
  context.setProp(context.global, BUILTINS_GLOBAL_KEY, namespace)
  namespace.dispose()

  runtime.setModuleLoader((moduleName) => {
    const canonical = toCanonicalBuiltinId(moduleName)
    if (canonical === 'path') {
      return PATH_MODULE_SOURCE
    }
    if (canonical === 'buffer') {
      return BUFFER_MODULE_SOURCE
    }
    if (canonical === 'path/win32') {
      return {
        error: new Error(
          `Cannot find module '${moduleName}'. Instant path is POSIX-only; path/win32 is not supported.`,
        ),
      }
    }
    return { error: formatMissingModuleError(moduleName, listImplemented()) }
  })

  const requireFn = context.newFunction('require', (idHandle) => {
    const requested = dumpArgString(context, idHandle)
    const canonical = toCanonicalBuiltinId(requested)
    if (canonical === 'path/win32') {
      throw new Error(
        `Cannot find module '${requested}'. Instant path is POSIX-only; path/win32 is not supported.`,
      )
    }
    const handle = lookupBuiltinHandle(context, canonical)
    if (handle === undefined) {
      throw formatMissingModuleError(requested, listImplemented())
    }
    return handle
  })
  context.setProp(context.global, 'require', requireFn)
  requireFn.dispose()

  return { listImplemented }
}
