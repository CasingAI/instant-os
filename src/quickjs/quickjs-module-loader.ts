/**
 * 模块路径解析与 ESM 文件加载（L1.8）。
 *
 * Node 双轨：
 * - ESM `import`：不探扩展名（须写全 `.js` / `.mjs` / `.cjs`）
 * - CJS `require` 文件级补全：见 {@link resolveCjsSpecifier}（L1.9）
 */
import { createPosixPathApi } from './quickjs-path.ts'
import {
  assertFsPermission,
  assertMaxFileBytes,
} from './quickjs-fs-path.ts'
import { QuickJsFsError, toQuickJsFsError } from './quickjs-fs-errors.ts'
import type { QuickJsFsHostOps } from './quickjs-fs-vfs.ts'
import { filesReadText, filesStat } from '../apps/files/files-api.ts'

/** ESM 允许的显式扩展名（对齐 Node ESM；不做自动补全）。 */
const ESM_FILE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])

export type QuickJsModuleResolveKind = 'builtin' | 'file' | 'bare'

export type QuickJsResolvedModule =
  | { kind: 'builtin'; id: string }
  | { kind: 'file'; absolutePath: string }

export class QuickJsModuleError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'QuickJsModuleError'
    this.code = code
  }
}

function stripNodePrefix(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('node:')) {
    return trimmed.slice('node:'.length)
  }
  return trimmed
}

/** 是否为相对或绝对文件说明符（非裸名、非 node:）。 */
export function isFileModuleSpecifier(requested: string): boolean {
  const trimmed = requested.trim()
  if (trimmed.startsWith('node:')) {
    return false
  }
  return trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')
}

export function classifyModuleSpecifier(requested: string): QuickJsModuleResolveKind {
  const trimmed = requested.trim()
  if (trimmed.startsWith('node:')) {
    return 'builtin'
  }
  if (isFileModuleSpecifier(trimmed)) {
    return 'file'
  }
  return 'bare'
}

/**
 * 将相对/绝对说明符解析为 VFS 绝对路径（不做扩展名探测）。
 * `baseModuleName` 为导入方模块名（通常已是绝对路径，如 `/user/[eval-1].js`）。
 */
export function resolvePathAgainstBase(
  baseModuleName: string,
  requestedName: string,
  getCwd: () => string,
): string {
  const pathApi = createPosixPathApi(getCwd)
  const request = requestedName.trim()
  if (pathApi.isAbsolute(request)) {
    return pathApi.normalize(request)
  }

  const base = baseModuleName.trim()
  const baseDir = pathApi.isAbsolute(base) ? pathApi.dirname(base) : getCwd()
  return pathApi.resolve(baseDir, request)
}

function esmExtensionOf(absolutePath: string): string {
  const pathApi = createPosixPathApi(() => '/')
  return pathApi.extname(absolutePath).toLowerCase()
}

/**
 * Node ESM：相对/绝对说明符须带显式扩展名；不探 `.js` / index。
 */
export function resolveEsmSpecifier(
  baseModuleName: string,
  requestedName: string,
  getCwd: () => string,
): string {
  const absolutePath = resolvePathAgainstBase(baseModuleName, requestedName, getCwd)
  const ext = esmExtensionOf(absolutePath)
  if (!ESM_FILE_EXTENSIONS.has(ext)) {
    throw new QuickJsModuleError(
      'ERR_MODULE_NOT_FOUND',
      `Cannot find module '${requestedName}'. ESM import requires an explicit file extension (.js, .mjs, or .cjs); Instant does not probe extensions for import (Node ESM). Got path '${absolutePath}'.`,
    )
  }
  return absolutePath
}

/**
 * CJS 式扩展名 / 目录 index 探测（L1.9）。
 * L1.8 仅占位，避免与 ESM 解析混用。
 */
export function resolveCjsSpecifier(
  _baseModuleName: string,
  requestedName: string,
  _getCwd: () => string,
): string {
  throw new QuickJsModuleError(
    'ERR_NOT_IMPLEMENTED',
    `Cannot find module '${requestedName}'. File-level require with CJS extension probing is L1.9; use ESM import './file.js' for now.`,
  )
}

export type NormalizeModuleRequestOptions = {
  getCwd: () => string
  /** 已实现的内建 id（canonical，无 node: 前缀）。 */
  isImplementedBuiltin: (canonicalId: string) => boolean
  /** 已知 Node 内建名（含未实现），用于更清晰报错。 */
  isKnownNodeBuiltin: (canonicalId: string) => boolean
  listImplemented: () => string[]
  /** 将 path/posix 等别名收成 canonical。 */
  toCanonicalBuiltinId: (raw: string) => string
}

/**
 * 共享入口：内建 id / ESM 文件绝对路径；裸名拒绝（L2）。
 */
export function normalizeModuleRequest(
  baseModuleName: string,
  requestedName: string,
  options: NormalizeModuleRequestOptions,
): QuickJsResolvedModule {
  const trimmed = requestedName.trim()
  if (!trimmed) {
    throw new QuickJsModuleError('ERR_INVALID_ARG_VALUE', 'Module name must be a non-empty string')
  }

  const kind = classifyModuleSpecifier(trimmed)

  if (kind === 'file') {
    return {
      kind: 'file',
      absolutePath: resolveEsmSpecifier(baseModuleName, trimmed, options.getCwd),
    }
  }

  // builtin 或裸名：先按 Node 内建表解释
  const canonical = options.toCanonicalBuiltinId(trimmed)
  if (options.isImplementedBuiltin(canonical) || options.isKnownNodeBuiltin(canonical)) {
    return { kind: 'builtin', id: canonical }
  }

  // 以 node: 开头但未知 → 仍当 builtin 报未实现
  if (trimmed.startsWith('node:')) {
    return { kind: 'builtin', id: canonical }
  }

  // 裸名第三方
  const implementedHint =
    options.listImplemented().length > 0
      ? options.listImplemented().map((name) => `'${name}'`).join(', ')
      : '(none)'
  throw new QuickJsModuleError(
    'ERR_MODULE_NOT_FOUND',
    `Cannot find module '${requestedName}'. Bare package names (node_modules) are not resolved yet (L2). Instant ESM loads relative/absolute file paths and implemented Node builtins. Implemented builtins: ${implementedHint}`,
  )
}

/** Asyncify 下从 VFS 读 ESM 源码（挂起）；同栈勿再嵌套可挂起桥。 */
export async function loadEsmModuleSourceFromVfs(
  absolutePath: string,
  ops: QuickJsFsHostOps,
): Promise<string> {
  if (ops.isDestroyed()) {
    throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed during module load')
  }
  assertFsPermission(absolutePath, 'read', ops.permissions, 'open')

  try {
    const entry = await filesStat(absolutePath)
    if (ops.isDestroyed()) {
      throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed during module load')
    }
    if (entry === undefined) {
      throw new QuickJsModuleError(
        'ERR_MODULE_NOT_FOUND',
        `Cannot find module '${absolutePath}'`,
      )
    }
    if (entry.kind === 'folder') {
      throw new QuickJsModuleError(
        'ERR_UNSUPPORTED_DIR_IMPORT',
        `Directory import is not supported: '${absolutePath}'. Specify the full file path (e.g. .../index.js).`,
      )
    }
    assertMaxFileBytes(entry.byteSize, ops.maxFileBytes, absolutePath, 'read')
    const text = await filesReadText(absolutePath)
    if (ops.isDestroyed()) {
      throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed during module load')
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

/** 粘贴 eval 默认入口：`{cwd}/[eval-{n}].js`（相对 import 相对 cwd）。 */
export function defaultEvalModuleFilename(cwd: string, evalSeq: number): string {
  const pathApi = createPosixPathApi(() => cwd)
  return pathApi.resolve(cwd, `[eval-${evalSeq}].js`)
}

/** 解析 eval 可选 filename（相对则相对 cwd）。 */
export function resolveEvalModuleFilename(
  filename: string | undefined,
  cwd: string,
  evalSeq: number,
): string {
  if (filename === undefined) {
    return defaultEvalModuleFilename(cwd, evalSeq)
  }
  const trimmed = filename.trim()
  if (!trimmed) {
    return defaultEvalModuleFilename(cwd, evalSeq)
  }
  const pathApi = createPosixPathApi(() => cwd)
  const resolved = pathApi.resolve(trimmed)
  if (!resolved.startsWith('/')) {
    throw new Error(`Eval filename must resolve to an absolute VFS path: ${resolved}`)
  }
  return resolved === '/' ? '/' : resolved.replace(/\/+$/, '')
}
