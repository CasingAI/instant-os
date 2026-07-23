/**
 * L1.9 / L1.10 文件级 CJS `require`（对齐 Node 薄子集）。
 *
 * Asyncify 回合制：宿主桥只做 resolve + 读源码并完整返回；禁止在挂起回调内
 * `evalCode` / `callFunction` 执行用户模块。模块包装、cache、循环依赖由 guest 编排
 *（见 `quickjs-cjs-guest-require.ts`）。嵌套 require / fs.*Sync 变为串行挂起。
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
  QuickJsModuleError,
  resolveBareSpecifierAsync,
  resolveCjsSpecifierAsync,
} from './quickjs-module-loader.ts'
import { createPosixPathApi } from './quickjs-path.ts'
import { filesReadText, filesStat } from '../apps/files/files-api.ts'

export type QuickJsCjsRequireHost = {
  getCwd: () => string
  fsOps: QuickJsFsHostOps
  /**
   * 当前 eval 入口路径（`instance.eval(..., { filename })` 解析后的绝对路径）。
   * 顶层 `require('./x')` 相对此文件；未在 eval 切片内时回退 `{cwd}/[eval].js`。
   */
  getEvalParentFilename?: () => string | undefined
  /** 查找已实现内建，返回新 handle（调用方/引擎负责生命周期）。 */
  lookupBuiltin: (canonicalId: string) => QuickJSHandle | undefined
  toCanonicalBuiltinId: (raw: string) => string
  isImplementedBuiltin: (canonicalId: string) => boolean
  isKnownNodeBuiltin: (canonicalId: string) => boolean
  listImplemented: () => string[]
  formatMissingModuleError: (requested: string) => Error
}

export type QuickJsCjsFetchKind = 'js' | 'json' | 'builtin'

export type QuickJsCjsRequireApi = {
  /**
   * 只 resolve + 读源码（或返回内建 exports）。
   * 可在 asyncified 桥内 await；不得在此路径执行用户模块体。
   */
  fetchModule: (requested: string, parentFilename: string) => Promise<QuickJSHandle>
  /** 仅解析路径，不求值。 */
  resolve: (requested: string, parentFilename: string) => Promise<string>
  /** 顶层 require 父路径：优先当前 eval filename，否则 `{cwd}/[eval].js`。 */
  evalParentFilename: () => string
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

function encodeBuiltinFetch(
  context: QuickJSAsyncContext,
  exportsHandle: QuickJSHandle,
): QuickJSHandle {
  const result = context.newObject()
  const kindHandle = context.newString('builtin')
  context.setProp(result, 'kind', kindHandle)
  kindHandle.dispose()
  context.setProp(result, 'exports', exportsHandle)
  exportsHandle.dispose()
  return result
}

function encodeSourceFetch(
  context: QuickJSAsyncContext,
  kind: 'js' | 'json',
  absolutePath: string,
  source: string,
): QuickJSHandle {
  const pathApi = pathApiRoot()
  const result = context.newObject()
  const kindHandle = context.newString(kind)
  context.setProp(result, 'kind', kindHandle)
  kindHandle.dispose()
  const filenameHandle = context.newString(absolutePath)
  context.setProp(result, 'filename', filenameHandle)
  filenameHandle.dispose()
  const dirnameHandle = context.newString(pathApi.dirname(absolutePath))
  context.setProp(result, 'dirname', dirnameHandle)
  dirnameHandle.dispose()
  const sourceHandle = context.newString(source)
  context.setProp(result, 'source', sourceHandle)
  sourceHandle.dispose()
  return result
}

/**
 * 创建实例级 CJS fetch / resolve（guest 薄 require 的宿主半边）。
 */
export function createCjsRequireApi(
  context: QuickJSAsyncContext,
  host: QuickJsCjsRequireHost,
): QuickJsCjsRequireApi {
  let disposed = false

  const evalParentFilename = (): string => {
    const active = host.getEvalParentFilename?.()
    if (typeof active === 'string' && active.trim() !== '') {
      return active.trim()
    }
    const pathApi = createPosixPathApi(host.getCwd)
    return pathApi.resolve(host.getCwd(), '[eval].js')
  }

  const fetchFileModule = async (absolutePath: string): Promise<QuickJSHandle> => {
    const ext = pathApiRoot().extname(absolutePath).toLowerCase()
    if (ext === '.mjs') {
      throw new QuickJsModuleError(
        'ERR_REQUIRE_ESM',
        `Must use import to load ES Module: ${absolutePath}`,
      )
    }
    const source = await readCjsSource(absolutePath, host.fsOps)
    if (ext === '.json') {
      return encodeSourceFetch(context, 'json', absolutePath, source)
    }
    return encodeSourceFetch(context, 'js', absolutePath, source)
  }

  const fetchModule = async (
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
          return encodeBuiltinFetch(context, handle)
        }
      }
      if (kind === 'builtin' || host.isKnownNodeBuiltin(canonical) || trimmed.startsWith('node:')) {
        throw host.formatMissingModuleError(requested)
      }
      const barePath = await resolveBareSpecifierAsync(parentFilename, trimmed, 'require')
      return fetchFileModule(barePath)
    }

    const resolved = await resolveCjsSpecifierAsync(parentFilename, trimmed, host.getCwd)
    return fetchFileModule(resolved.absolutePath)
  }

  const resolve = async (
    requested: string,
    parentFilename: string,
  ): Promise<string> => {
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
      if (host.isImplementedBuiltin(canonical) || host.isKnownNodeBuiltin(canonical)) {
        return canonical
      }
      if (kind === 'builtin' || trimmed.startsWith('node:')) {
        throw host.formatMissingModuleError(requested)
      }
      return resolveBareSpecifierAsync(parentFilename, trimmed, 'require')
    }
    const resolved = await resolveCjsSpecifierAsync(parentFilename, trimmed, host.getCwd)
    return resolved.absolutePath
  }

  return {
    fetchModule,
    resolve,
    evalParentFilename,
    dispose: () => {
      disposed = true
    },
  }
}

export { createModuleErrorHandle }
