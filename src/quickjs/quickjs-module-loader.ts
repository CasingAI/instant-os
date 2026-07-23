/**
 * 模块路径解析与 ESM / CJS 文件加载（L1.8 / L1.9）。
 *
 * Node 双轨：
 * - ESM `import`：不探扩展名（须写全 `.js` / `.mjs` / `.cjs`）
 * - CJS `require`：扩展名 / index 探测（见 {@link resolveCjsSpecifierAsync}）
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

/** CJS require 可加载的文件扩展名（不做 .node）。 */
const CJS_FILE_EXTENSIONS = new Set(['.js', '.cjs', '.json'])

/** LOAD_AS_FILE 探测用扩展名（顺序对齐 Node，省略 .node）。 */
const CJS_PROBE_EXTENSIONS = ['.js', '.json'] as const

/** LOAD_INDEX 文件名。 */
const CJS_INDEX_NAMES = ['index.js', 'index.json'] as const

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

function pathExtname(absolutePath: string): string {
  return createPosixPathApi(() => '/').extname(absolutePath).toLowerCase()
}

function pathJoin(dir: string, name: string): string {
  return createPosixPathApi(() => '/').join(dir, name)
}

async function statKind(
  absolutePath: string,
): Promise<'file' | 'folder' | undefined> {
  const entry = await filesStat(absolutePath)
  if (entry === undefined) {
    return undefined
  }
  return entry.kind === 'folder' ? 'folder' : 'file'
}

/**
 * CJS LOAD_AS_FILE + LOAD_INDEX（无 package.json main，见 L1.10）。
 * 返回最终可加载的绝对文件路径。
 */
export async function resolveCjsSpecifierAsync(
  baseModuleName: string,
  requestedName: string,
  getCwd: () => string,
): Promise<string> {
  const absolutePath = resolvePathAgainstBase(baseModuleName, requestedName, getCwd)
  const ext = pathExtname(absolutePath)

  if (ext === '.mjs') {
    throw new QuickJsModuleError(
      'ERR_REQUIRE_ESM',
      `Must use import to load ES Module: ${absolutePath}`,
    )
  }

  const tryAsFile = async (candidate: string): Promise<string | undefined> => {
    const kind = await statKind(candidate)
    if (kind !== 'file') {
      return undefined
    }
    const candidateExt = pathExtname(candidate)
    if (candidateExt === '.mjs') {
      throw new QuickJsModuleError(
        'ERR_REQUIRE_ESM',
        `Must use import to load ES Module: ${candidate}`,
      )
    }
    if (candidateExt && !CJS_FILE_EXTENSIONS.has(candidateExt) && candidateExt !== '') {
      // 无扩展名的文件 Node 仍可当 JS 加载；有未知扩展名时仍尝试当作 JS 文本
      if (candidateExt !== '.js' && candidateExt !== '.cjs' && candidateExt !== '.json') {
        // 允许无标准扩展名的精确文件（Node LOAD_AS_FILE 第一步）
      }
    }
    return candidate
  }

  const tryAsDirectory = async (dirPath: string): Promise<string | undefined> => {
    const kind = await statKind(dirPath)
    if (kind !== 'folder') {
      return undefined
    }
    for (const indexName of CJS_INDEX_NAMES) {
      const found = await tryAsFile(pathJoin(dirPath, indexName))
      if (found !== undefined) {
        return found
      }
    }
    return undefined
  }

  // LOAD_AS_FILE(X)：精确路径 → X.js → X.json
  const exact = await tryAsFile(absolutePath)
  if (exact !== undefined) {
    return exact
  }

  for (const probeExt of CJS_PROBE_EXTENSIONS) {
    // 已有同类扩展名时不重复追加（./foo.js 不试 ./foo.js.js）
    if (ext === probeExt) {
      continue
    }
    const found = await tryAsFile(`${absolutePath}${probeExt}`)
    if (found !== undefined) {
      return found
    }
  }

  // LOAD_AS_DIRECTORY(X)（跳过 package.json main）
  const asDir = await tryAsDirectory(absolutePath)
  if (asDir !== undefined) {
    return asDir
  }

  throw new QuickJsModuleError(
    'ERR_MODULE_NOT_FOUND',
    `Cannot find module '${requestedName}' (resolved base '${absolutePath}'). Instant CJS require probes .js/.json and index.js/index.json; package.json main/exports are L1.10; bare packages are L2.`,
  )
}

/**
 * @deprecated 使用 {@link resolveCjsSpecifierAsync}。保留同步占位以免旧引用静默走错路径。
 */
export function resolveCjsSpecifier(
  _baseModuleName: string,
  requestedName: string,
  _getCwd: () => string,
): string {
  throw new QuickJsModuleError(
    'ERR_NOT_IMPLEMENTED',
    `Cannot find module '${requestedName}'. Use resolveCjsSpecifierAsync (CJS require is async on the host).`,
  )
}

/**
 * 从 CJS 源码提取静态 `require('…')` / `require("…")` 说明符（薄实现，供宿主预载）。
 */
export function extractStaticRequireSpecifiers(source: string): string[] {
  const results: string[] = []
  const seen = new Set<string>()
  const re = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g
  for (const match of source.matchAll(re)) {
    const id = match[2]
    if (id === undefined || id.length === 0 || seen.has(id)) {
      continue
    }
    seen.add(id)
    results.push(id)
  }
  return results
}

/** 按缓存键做同步 CJS 路径解析（扩展名 / index；不访问 VFS）。 */
export function resolveCjsFromCacheKeys(
  baseModuleName: string,
  requestedName: string,
  getCwd: () => string,
  hasCached: (absolutePath: string) => boolean,
): string | undefined {
  const absolutePath = resolvePathAgainstBase(baseModuleName, requestedName, getCwd)
  const ext = pathExtname(absolutePath)

  const candidates: string[] = [absolutePath]
  for (const probeExt of CJS_PROBE_EXTENSIONS) {
    if (ext !== probeExt) {
      candidates.push(`${absolutePath}${probeExt}`)
    }
  }
  for (const indexName of CJS_INDEX_NAMES) {
    candidates.push(pathJoin(absolutePath, indexName))
  }

  for (const candidate of candidates) {
    if (hasCached(candidate)) {
      return candidate
    }
  }
  return undefined
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
