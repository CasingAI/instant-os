/**
 * L1.9 / L1.10 文件级 CJS `require`（对齐 Node 薄子集）。
 *
 * Asyncify 约束：asyncified `require` 内不可再调 asyncified（含 fs.*Sync / 嵌套 asyncified require）。
 * 因此文件加载在宿主侧递归完成：静态 `require('…')` 预载入缓存，模块体用同步 `require`（只打缓存 + 内建）。
 * L1.10：目录 → package.json 入口后，用 directoryAlias 供嵌套 sync require 命中。
 */
import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten'
import {
  assertFsPermission,
  assertMaxFileBytes,
} from './quickjs-fs-path.ts'
import { QuickJsFsError, toQuickJsFsError } from './quickjs-fs-errors.ts'
import type { QuickJsFsHostOps } from './quickjs-fs-vfs.ts'
import {
  classifyModuleSpecifier,
  extractStaticRequireSpecifiers,
  QuickJsModuleError,
  resolveBareSpecifierAsync,
  resolveCjsFromCacheKeys,
  resolveCjsSpecifierAsync,
} from './quickjs-module-loader.ts'
import { createPosixPathApi } from './quickjs-path.ts'
import { filesReadText, filesStat } from '../apps/files/files-api.ts'

export type QuickJsCjsRequireHost = {
  getCwd: () => string
  fsOps: QuickJsFsHostOps
  /** 查找已实现内建，返回新 handle（调用方/引擎负责生命周期）。 */
  lookupBuiltin: (canonicalId: string) => QuickJSHandle | undefined
  toCanonicalBuiltinId: (raw: string) => string
  isImplementedBuiltin: (canonicalId: string) => boolean
  isKnownNodeBuiltin: (canonicalId: string) => boolean
  listImplemented: () => string[]
  formatMissingModuleError: (requested: string) => Error
}

type CacheEntry = {
  /** module 对象（含 exports）。 */
  moduleHandle: QuickJSHandle
  loading: boolean
}

export type QuickJsCjsRequireApi = {
  /** 宿主侧加载（可在 asyncified require 内 await）。 */
  load: (requested: string, parentFilename: string) => Promise<QuickJSHandle>
  /** 仅解析路径，不求值。 */
  resolve: (requested: string, parentFilename: string) => Promise<string>
  /** 顶层 eval 用的虚拟父路径：`{cwd}/[eval].js`。 */
  evalParentFilename: () => string
  /** 同步 require（仅缓存 + 内建；供 CJS 包装注入）。 */
  createSyncRequireHandle: (parentFilename: string) => QuickJSHandle
  /** guest `require.cache` 对象（与宿主 Map 同步的薄视图）。 */
  getRequireCacheHandle: () => QuickJSHandle
  dispose: () => void
}

function pathApiRoot() {
  return createPosixPathApi(() => '/')
}

function createModuleErrorHandle(
  context: QuickJSAsyncContext,
  error: unknown,
): QuickJSHandle {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error instanceof QuickJsModuleError
      ? error.code
      : error instanceof QuickJsFsError
        ? error.code
        : 'ERR_MODULE_NOT_FOUND'
  return context.unwrapResult(
    context.evalCode(
      `(function () {
        var e = new Error(${JSON.stringify(message)});
        e.code = ${JSON.stringify(code)};
        return e;
      })()`,
      'instant-cjs-error.js',
    ),
  )
}

async function readCjsSource(
  absolutePath: string,
  ops: QuickJsFsHostOps,
): Promise<string> {
  if (ops.isDestroyed()) {
    throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed during require')
  }
  assertFsPermission(absolutePath, 'read', ops.permissions, 'open')
  try {
    const entry = await filesStat(absolutePath)
    if (ops.isDestroyed()) {
      throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed during require')
    }
    if (entry === undefined) {
      throw new QuickJsModuleError('ERR_MODULE_NOT_FOUND', `Cannot find module '${absolutePath}'`)
    }
    if (entry.kind === 'folder') {
      throw new QuickJsModuleError(
        'ERR_MODULE_NOT_FOUND',
        `Cannot find module '${absolutePath}' (is a directory)`,
      )
    }
    assertMaxFileBytes(entry.byteSize, ops.maxFileBytes, absolutePath, 'read')
    const text = await filesReadText(absolutePath)
    if (ops.isDestroyed()) {
      throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed during require')
    }
    const bytes = new TextEncoder().encode(text)
    assertMaxFileBytes(bytes.byteLength, ops.maxFileBytes, absolutePath, 'read')
    return text
  } catch (error) {
    if (error instanceof QuickJsModuleError || error instanceof QuickJsFsError) {
      throw error
    }
    throw toQuickJsFsError(error, 'open')
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

/**
 * 创建实例级 CJS require 系统。
 */
export function createCjsRequireApi(
  context: QuickJSAsyncContext,
  host: QuickJsCjsRequireHost,
): QuickJsCjsRequireApi {
  const cache = new Map<string, CacheEntry>()
  /** 目录绝对路径 → 入口文件（package.json main/exports 解析结果）。 */
  const directoryAliases = new Map<string, string>()
  /** 裸名 → 已解析入口文件（供 sync require 命中）。 */
  const bareResolved = new Map<string, string>()
  const requireCacheHandle = context.newObject()
  let disposed = false

  const rememberDirectoryAlias = (directoryAlias: string | undefined, filePath: string): void => {
    if (directoryAlias === undefined) {
      return
    }
    directoryAliases.set(directoryAlias, filePath)
  }

  const evalParentFilename = (): string => {
    const pathApi = createPosixPathApi(host.getCwd)
    return pathApi.resolve(host.getCwd(), '[eval].js')
  }

  const getExportsHandle = (entry: CacheEntry): QuickJSHandle => {
    return context.getProp(entry.moduleHandle, 'exports')
  }

  const syncLookup = (requested: string, parentFilename: string): QuickJSHandle => {
    const trimmed = requested.trim()
    if (!trimmed) {
      throw new QuickJsModuleError('ERR_INVALID_ARG_VALUE', 'The "id" argument must be of type string')
    }

    const kind = classifyModuleSpecifier(trimmed)
    if (kind === 'bare' || kind === 'builtin') {
      const canonical = host.toCanonicalBuiltinId(trimmed)
      if (canonical === 'path/win32') {
        throw new Error(
          `Cannot find module '${requested}'. Instant path is POSIX-only; path/win32 is not supported.`,
        )
      }
      if (host.isImplementedBuiltin(canonical)) {
        const handle = host.lookupBuiltin(canonical)
        if (handle !== undefined) {
          return handle
        }
      }
      if (kind === 'builtin' || host.isKnownNodeBuiltin(canonical) || trimmed.startsWith('node:')) {
        throw host.formatMissingModuleError(requested)
      }
      if (kind === 'bare') {
        // 宿主预载阶段已解析的裸名 → 文件路径
        const cachedBare = bareResolved.get(`${parentFilename}\0${trimmed}`) ?? bareResolved.get(trimmed)
        if (cachedBare !== undefined) {
          const entry = cache.get(cachedBare)
          if (entry !== undefined) {
            return getExportsHandle(entry)
          }
        }
        throw host.formatMissingModuleError(requested)
      }
    }

    // 文件：只打缓存（扩展名 / index / 目录别名）
    const cachedPath = resolveCjsFromCacheKeys(
      parentFilename,
      trimmed,
      host.getCwd,
      (p) => cache.has(p),
      (dir) => directoryAliases.get(dir),
    )
    if (cachedPath !== undefined) {
      const entry = cache.get(cachedPath)
      if (entry !== undefined) {
        return getExportsHandle(entry)
      }
    }

    throw new QuickJsModuleError(
      'ERR_MODULE_NOT_FOUND',
      `Cannot find module '${requested}'. Nested require only sees the instance cache (static require('…') is preloaded by the host). Dynamic/computed ids must already be loaded. Parent: ${parentFilename}`,
    )
  }

  const createSyncRequireHandle = (parentFilename: string): QuickJSHandle => {
    const requireFn = context.newFunction('require', (idHandle) => {
      try {
        return syncLookup(dumpArgString(context, idHandle), parentFilename)
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error))
      }
    })
    return requireFn
  }

  const registerInGuestCache = (absolutePath: string, moduleHandle: QuickJSHandle): void => {
    context.setProp(requireCacheHandle, absolutePath, moduleHandle)
  }

  const load = async (
    requested: string,
    parentFilename: string,
  ): Promise<QuickJSHandle> => {
    if (disposed || host.fsOps.isDestroyed()) {
      throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed during require')
    }

    const trimmed = requested.trim()
    if (!trimmed) {
      throw new QuickJsModuleError('ERR_INVALID_ARG_VALUE', 'The "id" argument must be of type string')
    }

    const kind = classifyModuleSpecifier(trimmed)
    if (kind !== 'file') {
      const canonical = host.toCanonicalBuiltinId(trimmed)
      if (canonical === 'path/win32') {
        throw new Error(
          `Cannot find module '${requested}'. Instant path is POSIX-only; path/win32 is not supported.`,
        )
      }
      if (host.isImplementedBuiltin(canonical)) {
        const handle = host.lookupBuiltin(canonical)
        if (handle !== undefined) {
          return handle
        }
      }
      if (kind === 'builtin' || host.isKnownNodeBuiltin(canonical) || trimmed.startsWith('node:')) {
        throw host.formatMissingModuleError(requested)
      }
      // bare package → node_modules
      const barePath = await resolveBareSpecifierAsync(parentFilename, trimmed, 'require')
      bareResolved.set(`${parentFilename}\0${trimmed}`, barePath)
      bareResolved.set(trimmed, barePath)
      const existingBare = cache.get(barePath)
      if (existingBare !== undefined) {
        return getExportsHandle(existingBare)
      }
      return loadFileModule(barePath)
    }

    const resolved = await resolveCjsSpecifierAsync(
      parentFilename,
      trimmed,
      host.getCwd,
    )
    const absolutePath = resolved.absolutePath
    rememberDirectoryAlias(resolved.directoryAlias, absolutePath)

    const existing = cache.get(absolutePath)
    if (existing !== undefined) {
      return getExportsHandle(existing)
    }

    return loadFileModule(absolutePath)
  }

  const loadFileModule = async (absolutePath: string): Promise<QuickJSHandle> => {
    const existing = cache.get(absolutePath)
    if (existing !== undefined) {
      return getExportsHandle(existing)
    }

    const exportsHandle = context.newObject()
    const moduleHandle = context.newObject()
    context.setProp(moduleHandle, 'exports', exportsHandle)
    exportsHandle.dispose()

    const idStr = context.newString(absolutePath)
    context.setProp(moduleHandle, 'id', idStr)
    idStr.dispose()
    const filenameStr = context.newString(absolutePath)
    context.setProp(moduleHandle, 'filename', filenameStr)
    filenameStr.dispose()
    context.setProp(moduleHandle, 'loaded', context.false)

    const entry: CacheEntry = { moduleHandle, loading: true }
    cache.set(absolutePath, entry)
    registerInGuestCache(absolutePath, moduleHandle)

    const ext = pathApiRoot().extname(absolutePath).toLowerCase()

    try {
      if (ext === '.json') {
        const text = await readCjsSource(absolutePath, host.fsOps)
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new QuickJsModuleError(
            'ERR_INVALID_JSON',
            `Unexpected token in JSON module '${absolutePath}': ${message}`,
          )
        }
        const valueHandle = context.unwrapResult(
          context.evalCode(`(${JSON.stringify(parsed)})`, absolutePath),
        )
        context.setProp(moduleHandle, 'exports', valueHandle)
        valueHandle.dispose()
        context.setProp(moduleHandle, 'loaded', context.true)
        entry.loading = false
        return getExportsHandle(entry)
      }

      if (ext === '.mjs') {
        throw new QuickJsModuleError(
          'ERR_REQUIRE_ESM',
          `Must use import to load ES Module: ${absolutePath}`,
        )
      }

      const source = await readCjsSource(absolutePath, host.fsOps)

      // 静态 require 预载（宿主递归；避免嵌套 Asyncify）
      for (const dep of extractStaticRequireSpecifiers(source)) {
        const depKind = classifyModuleSpecifier(dep)
        if (depKind === 'file') {
          await load(dep, absolutePath)
        } else if (depKind === 'bare') {
          const canonical = host.toCanonicalBuiltinId(dep)
          if (
            host.isImplementedBuiltin(canonical) ||
            host.isKnownNodeBuiltin(canonical)
          ) {
            continue
          }
          try {
            await load(dep, absolutePath)
          } catch {
            // 条件分支中的可选依赖：求值时再报错
          }
        } else {
          const canonical = host.toCanonicalBuiltinId(dep)
          if (host.isImplementedBuiltin(canonical) || host.isKnownNodeBuiltin(canonical)) {
            continue
          }
        }
      }

      const dirname = pathApiRoot().dirname(absolutePath)
      const syncRequire = createSyncRequireHandle(absolutePath)
      const filenameHandle = context.newString(absolutePath)
      const dirnameHandle = context.newString(dirname)

      const wrapper = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`
      const fnResult = context.evalCode(wrapper, absolutePath)
      if (fnResult.error) {
        syncRequire.dispose()
        filenameHandle.dispose()
        dirnameHandle.dispose()
        const err = context.dump(fnResult.error)
        fnResult.error.dispose()
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err))
      }

      const fnHandle = fnResult.value
      const exportsBefore = context.getProp(moduleHandle, 'exports')
      const callResult = context.callFunction(
        fnHandle,
        context.undefined,
        exportsBefore,
        syncRequire,
        moduleHandle,
        filenameHandle,
        dirnameHandle,
      )
      exportsBefore.dispose()
      fnHandle.dispose()
      syncRequire.dispose()
      filenameHandle.dispose()
      dirnameHandle.dispose()

      if (callResult.error) {
        const err = context.dump(callResult.error)
        callResult.error.dispose()
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err))
      }
      callResult.value.dispose()

      context.setProp(moduleHandle, 'loaded', context.true)
      entry.loading = false
      return getExportsHandle(entry)
    } catch (error) {
      cache.delete(absolutePath)
      // 从 guest cache 移除
      const undef = context.undefined
      context.setProp(requireCacheHandle, absolutePath, undef)
      moduleHandle.dispose()
      throw error
    }
  }

  const resolve = async (
    requested: string,
    parentFilename: string,
  ): Promise<string> => {
    const trimmed = requested.trim()
    if (!trimmed) {
      throw new QuickJsModuleError('ERR_INVALID_ARG_VALUE', 'The "id" argument must be of type string')
    }
    const kind = classifyModuleSpecifier(trimmed)
    if (kind !== 'file') {
      const canonical = host.toCanonicalBuiltinId(trimmed)
      if (host.isImplementedBuiltin(canonical) || host.isKnownNodeBuiltin(canonical)) {
        return canonical
      }
      throw host.formatMissingModuleError(requested)
    }
    const resolved = await resolveCjsSpecifierAsync(parentFilename, trimmed, host.getCwd)
    rememberDirectoryAlias(resolved.directoryAlias, resolved.absolutePath)
    return resolved.absolutePath
  }

  return {
    load,
    resolve,
    evalParentFilename,
    createSyncRequireHandle,
    getRequireCacheHandle: () => requireCacheHandle,
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      for (const entry of cache.values()) {
        if (entry.moduleHandle.alive) {
          entry.moduleHandle.dispose()
        }
      }
      cache.clear()
      directoryAliases.clear()
      if (requireCacheHandle.alive) {
        requireCacheHandle.dispose()
      }
    },
  }
}

export { createModuleErrorHandle }
