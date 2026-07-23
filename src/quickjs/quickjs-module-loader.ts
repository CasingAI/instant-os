/**
 * 模块路径解析与 ESM / CJS 文件加载（L1.8 / L1.9 / L1.10）。
 *
 * Node 双轨：
 * - ESM `import`：不探扩展名（须写全 `.js` / `.mjs` / `.cjs`）；无 folder mains
 * - CJS `require`：扩展名 / package.json 入口 / index 探测（见 {@link resolveCjsSpecifierAsync}）
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

function pathDirname(absolutePath: string): string {
  return createPosixPathApi(() => '/').dirname(absolutePath)
}

async function statKind(
  absolutePath: string,
): Promise<'file' | 'folder' | 'symlink' | undefined> {
  const entry = await filesStat(absolutePath)
  if (entry === undefined) {
    return undefined
  }
  if (entry.kind === 'folder') return 'folder'
  if (entry.kind === 'symlink') return 'symlink'
  return 'file'
}

/** 解析裸包名中的包名与子路径（如 `lodash/get` → name=lodash, subpath=get） */
export function splitBarePackageName(requested: string): {
  packageName: string
  subpath: string | undefined
} {
  const trimmed = requested.trim()
  if (trimmed.startsWith('@')) {
    const parts = trimmed.split('/')
    if (parts.length < 2) {
      return { packageName: trimmed, subpath: undefined }
    }
    const packageName = `${parts[0]}/${parts[1]}`
    const rest = parts.slice(2).join('/')
    return { packageName, subpath: rest || undefined }
  }
  const slash = trimmed.indexOf('/')
  if (slash === -1) {
    return { packageName: trimmed, subpath: undefined }
  }
  return {
    packageName: trimmed.slice(0, slash),
    subpath: trimmed.slice(slash + 1) || undefined,
  }
}

/**
 * 从 importing 文件向上查找 `node_modules/<pkg>`（跟随 symlink）。
 */
export async function findPackageRootFromImporter(
  importerAbsolutePath: string,
  packageName: string,
): Promise<string | undefined> {
  let dir = pathDirname(importerAbsolutePath)
  const pathApi = createPosixPathApi(() => '/')
  for (;;) {
    const candidate = pathApi.join(dir, 'node_modules', ...packageName.split('/'))
    const kind = await statKind(candidate)
    // filesStat 跟随 symlink → 目录或文件包根
    if (kind === 'folder' || kind === 'file') {
      // 包根应是目录（含 package.json）
      if (kind === 'folder') {
        const pkgJson = await statKind(pathJoin(candidate, 'package.json'))
        if (pkgJson === 'file') return candidate
      }
    }
    const parent = pathDirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

const ESM_EXPORT_CONDITIONS = ['import', 'node', 'default'] as const

function resolveExportsWithConditions(
  packageRoot: string,
  exportsField: unknown,
  conditions: readonly string[],
  subpath: string | undefined,
): string {
  let target: unknown = exportsField
  const exportKey = subpath ? `./${subpath}` : '.'

  if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
    const map = target as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(map, exportKey)) {
      target = map[exportKey]
    } else if (exportKey !== '.') {
      throw new QuickJsModuleError(
        'ERR_PACKAGE_PATH_NOT_EXPORTED',
        `Package subpath '${exportKey}' is not defined by "exports" in ${pathJoin(packageRoot, 'package.json')}`,
      )
    } else if (Object.prototype.hasOwnProperty.call(map, '.')) {
      target = map['.']
    }
  }

  if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
    const conditionsMap = target as Record<string, unknown>
    let matched: unknown
    for (const condition of conditions) {
      if (Object.prototype.hasOwnProperty.call(conditionsMap, condition)) {
        matched = conditionsMap[condition]
        break
      }
    }
    if (matched === undefined) {
      throw new QuickJsModuleError(
        'ERR_PACKAGE_PATH_NOT_EXPORTED',
        `No matching "exports" condition in ${pathJoin(packageRoot, 'package.json')}`,
      )
    }
    target = matched
  }

  if (typeof target !== 'string' || !target.startsWith('./')) {
    throw new QuickJsModuleError(
      'ERR_INVALID_PACKAGE_TARGET',
      `Invalid "exports" target in ${pathJoin(packageRoot, 'package.json')}`,
    )
  }
  const resolved = pathResolve(packageRoot, target)
  if (!isPathInsidePackageRoot(packageRoot, resolved)) {
    throw new QuickJsModuleError(
      'ERR_INVALID_PACKAGE_TARGET',
      `Invalid "exports" target escapes package root`,
    )
  }
  return resolved
}

/**
 * 将裸名解析为绝对文件路径（CJS：require 条件；ESM：import 条件）。
 */
export async function resolveBareSpecifierAsync(
  importerAbsolutePath: string,
  requestedName: string,
  mode: 'require' | 'import',
): Promise<string> {
  const { packageName, subpath } = splitBarePackageName(requestedName)
  const packageRoot = await findPackageRootFromImporter(importerAbsolutePath, packageName)
  if (!packageRoot) {
    throw new QuickJsModuleError(
      'ERR_MODULE_NOT_FOUND',
      `Cannot find module '${requestedName}' in node_modules (from '${importerAbsolutePath}')`,
    )
  }

  const pkgJsonPath = pathJoin(packageRoot, 'package.json')
  const pkgText = await filesReadText(pkgJsonPath)
  const pkg = JSON.parse(pkgText) as {
    main?: string
    module?: string
    exports?: unknown
  }

  if (pkg.exports !== undefined) {
    const conditions = mode === 'import' ? ESM_EXPORT_CONDITIONS : CJS_EXPORT_CONDITIONS
    return resolveExportsWithConditions(packageRoot, pkg.exports, conditions, subpath)
  }

  if (subpath) {
    const candidate = pathJoin(packageRoot, subpath)
    const asFile = await resolveCjsEntryLike(candidate)
    if (asFile) return asFile
    throw new QuickJsModuleError(
      'ERR_MODULE_NOT_FOUND',
      `Cannot find module '${requestedName}'`,
    )
  }

  if (mode === 'import' && typeof pkg.module === 'string') {
    const modPath = pathResolve(packageRoot, pkg.module.startsWith('.') ? pkg.module : `./${pkg.module}`)
    const kind = await statKind(modPath)
    if (kind === 'file') return modPath
  }

  if (typeof pkg.main === 'string') {
    const mainPath = pathResolve(packageRoot, pkg.main.startsWith('.') ? pkg.main : `./${pkg.main}`)
    const resolved = await resolveCjsEntryLike(mainPath)
    if (resolved) return resolved
  }

  const indexJs = pathJoin(packageRoot, 'index.js')
  const indexKind = await statKind(indexJs)
  if (indexKind === 'file') return indexJs

  throw new QuickJsModuleError(
    'ERR_MODULE_NOT_FOUND',
    `Cannot find module '${requestedName}' (no main/index in ${packageRoot})`,
  )
}

async function resolveCjsEntryLike(entryPath: string): Promise<string | undefined> {
  const kind = await statKind(entryPath)
  if (kind === 'file') return entryPath
  for (const ext of CJS_PROBE_EXTENSIONS) {
    const found = await statKind(`${entryPath}${ext}`)
    if (found === 'file') return `${entryPath}${ext}`
  }
  if (kind === 'folder') {
    for (const name of CJS_INDEX_NAMES) {
      const idx = pathJoin(entryPath, name)
      const found = await statKind(idx)
      if (found === 'file') return idx
    }
  }
  return undefined
}

/** 同步 normalizer 用：把裸名编码成 loader 可识别的伪模块名 */
export const BARE_MODULE_PREFIX = 'instant-bare:'

export function encodeBareModuleName(baseModuleName: string, requestedName: string): string {
  return `${BARE_MODULE_PREFIX}${encodeURIComponent(baseModuleName)}:${encodeURIComponent(requestedName)}`
}

export function tryDecodeBareModuleName(
  moduleName: string,
): { baseModuleName: string; requestedName: string } | undefined {
  if (!moduleName.startsWith(BARE_MODULE_PREFIX)) return undefined
  const rest = moduleName.slice(BARE_MODULE_PREFIX.length)
  const colon = rest.indexOf(':')
  if (colon === -1) return undefined
  return {
    baseModuleName: decodeURIComponent(rest.slice(0, colon)),
    requestedName: decodeURIComponent(rest.slice(colon + 1)),
  }
}

function pathNormalize(absolutePath: string): string {
  return createPosixPathApi(() => '/').normalize(absolutePath)
}

function pathResolve(fromDir: string, relative: string): string {
  return createPosixPathApi(() => fromDir).resolve(fromDir, relative)
}

function isPathInsidePackageRoot(packageRoot: string, candidate: string): boolean {
  const root = pathNormalize(packageRoot).replace(/\/+$/, '') || '/'
  const target = pathNormalize(candidate)
  if (root === '/') {
    return target.startsWith('/')
  }
  return target === root || target.startsWith(`${root}/`)
}

/** CJS 条件：require → node → default（L1.10 单层子集）。 */
const CJS_EXPORT_CONDITIONS = ['require', 'node', 'default'] as const

/**
 * 解析 package.json 的 exports["."] / 顶层字符串 exports（仅 CJS）。
 * 有 exports 字段时不回退 main。
 */
function resolvePackageExportsDot(
  packageRoot: string,
  exportsField: unknown,
): string {
  let target: unknown = exportsField

  if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
    const map = target as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(map, '.')) {
      throw new QuickJsModuleError(
        'ERR_PACKAGE_PATH_NOT_EXPORTED',
        `Package subpath '.' is not defined by "exports" in ${pathJoin(packageRoot, 'package.json')}`,
      )
    }
    target = map['.']
  }

  if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
    const conditions = target as Record<string, unknown>
    let matched: unknown
    for (const condition of CJS_EXPORT_CONDITIONS) {
      if (Object.prototype.hasOwnProperty.call(conditions, condition)) {
        matched = conditions[condition]
        break
      }
    }
    if (matched === undefined) {
      throw new QuickJsModuleError(
        'ERR_PACKAGE_PATH_NOT_EXPORTED',
        `No "exports" main entry (require/node/default) in ${pathJoin(packageRoot, 'package.json')}`,
      )
    }
    target = matched
  }

  if (typeof target !== 'string' || !target.startsWith('./')) {
    throw new QuickJsModuleError(
      'ERR_INVALID_PACKAGE_TARGET',
      `Invalid "exports" target for '.' in ${pathJoin(packageRoot, 'package.json')} (L1.10 expects a string starting with ./)`,
    )
  }

  const resolved = pathResolve(packageRoot, target)
  if (!isPathInsidePackageRoot(packageRoot, resolved)) {
    throw new QuickJsModuleError(
      'ERR_INVALID_PACKAGE_TARGET',
      `Invalid "exports" target '${target}' escapes package root ${packageRoot}`,
    )
  }
  return resolved
}

async function tryReadPackageJson(
  dirPath: string,
): Promise<Record<string, unknown> | undefined> {
  const pkgPath = pathJoin(dirPath, 'package.json')
  const kind = await statKind(pkgPath)
  if (kind !== 'file') {
    return undefined
  }
  let text: string
  try {
    text = await filesReadText(pkgPath)
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new QuickJsModuleError(
        'ERR_INVALID_PACKAGE_CONFIG',
        `Invalid package.json (not an object): ${pkgPath}`,
      )
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof QuickJsModuleError) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new QuickJsModuleError(
      'ERR_INVALID_PACKAGE_CONFIG',
      `Invalid package.json ${pkgPath}: ${message}`,
    )
  }
}

export type ResolveCjsResult = {
  /** 最终可加载的绝对文件路径。 */
  absolutePath: string
  /**
   * 若经 LOAD_AS_DIRECTORY 解析，记录目录绝对路径，
   * 供嵌套 sync require 在 package.json main 非 index 时命中缓存。
   */
  directoryAlias?: string
}

/**
 * CJS LOAD_AS_FILE + LOAD_AS_DIRECTORY（含 package.json exports["."] / main → index）。
 */
export async function resolveCjsSpecifierAsync(
  baseModuleName: string,
  requestedName: string,
  getCwd: () => string,
): Promise<ResolveCjsResult> {
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
    return candidate
  }

  /** 对入口路径做 LOAD_AS_FILE：精确 → .js → .json；也可再当目录 index。 */
  const resolveEntryTarget = async (entryPath: string): Promise<string | undefined> => {
    const exact = await tryAsFile(entryPath)
    if (exact !== undefined) {
      return exact
    }
    const entryExt = pathExtname(entryPath)
    for (const probeExt of CJS_PROBE_EXTENSIONS) {
      if (entryExt === probeExt) {
        continue
      }
      const found = await tryAsFile(`${entryPath}${probeExt}`)
      if (found !== undefined) {
        return found
      }
    }
    // main 指向子目录时：再试该目录的 index（无递归 package.json，避免嵌套复杂度）
    const asSubDir = await statKind(entryPath)
    if (asSubDir === 'folder') {
      for (const indexName of CJS_INDEX_NAMES) {
        const found = await tryAsFile(pathJoin(entryPath, indexName))
        if (found !== undefined) {
          return found
        }
      }
    }
    return undefined
  }

  const tryAsDirectory = async (
    dirPath: string,
  ): Promise<ResolveCjsResult | undefined> => {
    const kind = await statKind(dirPath)
    if (kind !== 'folder') {
      return undefined
    }

    const pkg = await tryReadPackageJson(dirPath)

    if (pkg !== undefined && Object.prototype.hasOwnProperty.call(pkg, 'exports')) {
      const entryTarget = resolvePackageExportsDot(dirPath, pkg.exports)
      const resolved = await resolveEntryTarget(entryTarget)
      if (resolved === undefined) {
        throw new QuickJsModuleError(
          'ERR_MODULE_NOT_FOUND',
          `Cannot find module '${requestedName}' (package exports '.' → '${entryTarget}')`,
        )
      }
      return { absolutePath: resolved, directoryAlias: dirPath }
    }

    if (pkg !== undefined && typeof pkg.main === 'string' && pkg.main.length > 0) {
      const mainRel = pkg.main.startsWith('./') ? pkg.main : `./${pkg.main}`
      const entryTarget = pathResolve(dirPath, mainRel)
      if (!isPathInsidePackageRoot(dirPath, entryTarget)) {
        throw new QuickJsModuleError(
          'ERR_INVALID_PACKAGE_CONFIG',
          `Invalid "main" target '${pkg.main}' escapes package root ${dirPath}`,
        )
      }
      const resolved = await resolveEntryTarget(entryTarget)
      if (resolved !== undefined) {
        return { absolutePath: resolved, directoryAlias: dirPath }
      }
      // main 无效时 Node 仍会尝试 index；与常见实现一致
    }

    for (const indexName of CJS_INDEX_NAMES) {
      const found = await tryAsFile(pathJoin(dirPath, indexName))
      if (found !== undefined) {
        return { absolutePath: found, directoryAlias: dirPath }
      }
    }
    return undefined
  }

  // LOAD_AS_FILE(X)：精确路径 → X.js → X.json
  const exact = await tryAsFile(absolutePath)
  if (exact !== undefined) {
    return { absolutePath: exact }
  }

  for (const probeExt of CJS_PROBE_EXTENSIONS) {
    // 已有同类扩展名时不重复追加（./foo.js 不试 ./foo.js.js）
    if (ext === probeExt) {
      continue
    }
    const found = await tryAsFile(`${absolutePath}${probeExt}`)
    if (found !== undefined) {
      return { absolutePath: found }
    }
  }

  // LOAD_AS_DIRECTORY(X)：package.json exports/main → index
  const asDir = await tryAsDirectory(absolutePath)
  if (asDir !== undefined) {
    return asDir
  }

  throw new QuickJsModuleError(
    'ERR_MODULE_NOT_FOUND',
    `Cannot find module '${requestedName}' (resolved base '${absolutePath}'). Instant CJS require probes .js/.json, package.json exports['.']/main, and index.js/index.json; bare packages are L2.`,
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

/** 按缓存键做同步 CJS 路径解析（扩展名 / index / 目录别名；不访问 VFS）。 */
export function resolveCjsFromCacheKeys(
  baseModuleName: string,
  requestedName: string,
  getCwd: () => string,
  hasCached: (absolutePath: string) => boolean,
  /** L1.10：LOAD_AS_DIRECTORY 解析出的 目录 → 入口文件 */
  resolveDirectoryAlias?: (dirAbsolutePath: string) => string | undefined,
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

  const aliasTarget = resolveDirectoryAlias?.(absolutePath)
  if (aliasTarget !== undefined) {
    candidates.push(aliasTarget)
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
 * 共享入口：内建 id / ESM 文件绝对路径 / 裸名编码（loader 异步解析）。
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

  // 裸名：编码后交 async loader 解析 node_modules
  return {
    kind: 'file',
    absolutePath: encodeBareModuleName(baseModuleName, trimmed),
  }
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
