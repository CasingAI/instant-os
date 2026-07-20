/**
 * 与 tsserver 同源的模块解析：从导入文件目录出发，经 TypeScript resolveModuleName
 * + files-api 异步缓存，向上查找 node_modules（含 pnpm / @types 尽力回退）。
 */
import ts from 'typescript'
import { filesList, filesReadText, filesStat } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { parentDirFromPath } from '../../monaco/monaco-language.ts'

const MAX_RESOLVE_ROUNDS = 24
const MAX_PENDING_PER_FLUSH = 64
const MAX_PNPM_SCAN = 400
const MAX_TRANSITIVE_BARE = 24
/** @types/node 含大量三斜线引用，需更高配额才能覆盖 os/fs 等 ambient */
export const MAX_TYPES_NODE_FILES = 120

/** from / import() / require / 无副作用 import */
const IMPORT_SPEC_RE =
  /(?:from\s+|import\s*\(|require\s*\(|import\s+)\s*['"]([^'"]+)['"]/g

/** /// <reference types="…" /> 或 path="…" */
const TRIPLE_SLASH_RE =
  /\/\/\/\s*<reference\s+(?:types|path)\s*=\s*['"]([^'"]+)['"]\s*\/>/g

type CacheEntry =
  | { kind: 'file'; content: string }
  | { kind: 'folder' }
  | { kind: 'missing' }

export type ResolvedModuleFiles = Map<string, string>

export type ResolveCompilerOptionsInput = {
  baseUrl?: string
  paths?: Record<string, string[]>
  moduleResolution?: string
  allowJs?: boolean
}

type PackageJsonShape = {
  types?: string
  typings?: string
  main?: string
  module?: string
  exports?: unknown
}

/** 常见 Node 内建（不含 node: 前缀）；用于触发 @types/node */
const NODE_BUILTIN_NAMES = new Set([
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
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
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
])

function normalizeAbs(path: string): string {
  const trimmed = path.replace(/\/+$/, '') || '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function joinAbs(root: string, ...segments: string[]): string {
  return joinFilesAbsolutePath(normalizeAbs(root), ...segments.filter(Boolean))
}

function packageNameSegments(packageName: string): string[] {
  return packageName.split('/').filter(Boolean)
}

function isJsModulePath(path: string): boolean {
  return /\.(?:[cm]?js|jsx)$/.test(path)
}

function isDeclarationPath(path: string): boolean {
  return path.endsWith('.d.ts') || path.endsWith('.d.mts') || path.endsWith('.d.cts')
}

/** scoped `@foo/bar` → `@types/foo__bar`；普通包 → `@types/pkg` */
export function typesPackageName(packageName: string): string {
  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.slice(1).split('/')
    if (scope && name) return `@types/${scope}__${name}`
  }
  return `@types/${packageName}`
}

/** `node:fs` → `fs`；其它协议返回 undefined */
export function normalizeNodeBuiltinSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith('node:')) {
    const name = specifier.slice('node:'.length)
    return name || undefined
  }
  if (NODE_BUILTIN_NAMES.has(specifier)) return specifier
  return undefined
}

export function isNodeBuiltinSpecifier(specifier: string): boolean {
  return normalizeNodeBuiltinSpecifier(specifier) !== undefined
}

/** 从完整 specifier 取出包名（`@scope/pkg/sub` → `@scope/pkg`） */
export function packageNameFromSpecifier(specifier: string): string | undefined {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return undefined
  const nodeBuiltin = normalizeNodeBuiltinSpecifier(specifier)
  if (nodeBuiltin) return undefined
  if (specifier.startsWith('data:') || specifier.startsWith('http:') || specifier.startsWith('https:')) {
    return undefined
  }
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    if (parts.length < 2) return undefined
    return `${parts[0]}/${parts[1]}`
  }
  return specifier.split('/')[0]
}

/** 解析用的裸包名：node:fs → fs；子路径保留 */
export function resolveTargetSpecifier(specifier: string): string {
  const nodeBuiltin = normalizeNodeBuiltinSpecifier(specifier)
  return nodeBuiltin ?? specifier
}

/** `os` → `os.d.ts`；`fs/promises` → `fs/promises.d.ts` */
export function typesNodeBuiltinDtsRel(builtinName: string): string {
  return `${builtinName}.d.ts`
}

/**
 * 从 containing 文件向上查找 `node_modules/@types/node` 包根。
 */
export async function findTypesNodePackageRoot(
  cache: FilesResolutionCache,
  fromFile: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  let dir = parentDirFromPath(normalizeAbs(fromFile))
  for (let i = 0; i < 24; i += 1) {
    if (signal?.aborted) return undefined
    const candidate = joinAbs(dir, 'node_modules', '@types', 'node')
    const pkgJson = joinAbs(candidate, 'package.json')
    cache.fileExists(pkgJson)
    await cache.flushPending(signal)
    if (cache.readFile(pkgJson) !== undefined) return candidate
    const parent = parentDirFromPath(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * 直注 Node 内建对应的 `@types/node/<name>.d.ts`，并收集 index / package.json。
 * @returns 内建 .d.ts 绝对路径（若找到）
 */
export async function collectNodeBuiltinDeclaration(
  cache: FilesResolutionCache,
  containingFile: string,
  specifier: string,
  out: ResolvedModuleFiles,
  signal?: AbortSignal,
  maxFiles = MAX_TYPES_NODE_FILES,
): Promise<string | undefined> {
  const builtin = normalizeNodeBuiltinSpecifier(specifier)
  if (!builtin) return undefined

  const typesRoot = await findTypesNodePackageRoot(cache, containingFile, signal)
  if (!typesRoot) return undefined

  const dtsRel = typesNodeBuiltinDtsRel(builtin)
  const dtsPath = joinAbs(typesRoot, ...dtsRel.split('/'))
  const pkgJson = joinAbs(typesRoot, 'package.json')
  const indexDts = joinAbs(typesRoot, 'index.d.ts')

  for (const path of [pkgJson, indexDts, dtsPath]) {
    cache.fileExists(path)
  }
  await cache.flushPending(signal)

  // 优先保证内建 dts 与 package.json 进 out
  for (const path of [pkgJson, dtsPath, indexDts]) {
    let text = cache.readFile(path)
    if (text === undefined) {
      cache.fileExists(path)
      await cache.flushPending(signal)
      text = cache.readFile(path)
    }
    if (text !== undefined) out.set(path, text)
  }

  if (cache.readFile(dtsPath) === undefined && cache.readFile(indexDts) === undefined) {
    return undefined
  }

  // 从 index + 内建 dts 继续展开（配额更高）
  const start = cache.readFile(dtsPath) !== undefined ? dtsPath : indexDts
  await collectResolvedPackageFiles(cache, start, out, signal, maxFiles)
  return cache.readFile(dtsPath) !== undefined ? dtsPath : start
}

/**
 * 解析前从 containing 向上预热 `node_modules/<pkg>/package.json`，便于 exports 解析。
 */
export async function seedPackageJsonForSpecifier(
  cache: FilesResolutionCache,
  containingFile: string,
  moduleName: string,
  signal?: AbortSignal,
): Promise<void> {
  const target = resolveTargetSpecifier(moduleName)
  const pkg = packageNameFromSpecifier(target)
  if (!pkg) return

  let dir = parentDirFromPath(normalizeAbs(containingFile))
  for (let i = 0; i < 24; i += 1) {
    if (signal?.aborted) return
    const pkgRoot = joinAbs(dir, 'node_modules', ...packageNameSegments(pkg))
    cache.directoryExists(pkgRoot)
    cache.fileExists(joinAbs(pkgRoot, 'package.json'))
    const parent = parentDirFromPath(dir)
    if (parent === dir) break
    dir = parent
  }
  await cache.flushPending(signal)
}

/**
 * 不依赖 resolveModuleName：向上找包根 package.json，按 types/exports 直达声明入口。
 * 用于 `@electron-toolkit/preload` 等 exports 包在缓存未齐时 resolveModuleName 失败的场景。
 */
export async function resolvePackageTypesEntryDirect(
  cache: FilesResolutionCache,
  containingFile: string,
  moduleName: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const target = resolveTargetSpecifier(moduleName)
  if (isNodeBuiltinSpecifier(target) || isNodeBuiltinSpecifier(moduleName)) return undefined

  const pkg = packageNameFromSpecifier(target)
  if (!pkg) return undefined

  let subpath: string | undefined
  if (target.startsWith(`${pkg}/`)) {
    subpath = target.slice(pkg.length + 1)
  }

  let dir = parentDirFromPath(normalizeAbs(containingFile))
  for (let i = 0; i < 24; i += 1) {
    if (signal?.aborted) return undefined
    const packageRoot = joinAbs(dir, 'node_modules', ...packageNameSegments(pkg))
    const pkgJsonPath = joinAbs(packageRoot, 'package.json')
    cache.fileExists(pkgJsonPath)
    await cache.flushPending(signal)
    const pkgRaw = cache.readFile(pkgJsonPath)
    if (pkgRaw !== undefined) {
      const pkgJson = parseJsonc<PackageJsonShape>(pkgRaw)
      const typesEntry = pkgJson ? typesEntryFromPackageJson(pkgJson, subpath) : undefined
      if (typesEntry) {
        const typesPath = joinAbs(packageRoot, ...typesEntry.replace(/^\.\//, '').split('/'))
        cache.fileExists(typesPath)
        await cache.flushPending(signal)
        if (cache.readFile(typesPath) !== undefined) return typesPath
      }
      // 常见回退
      for (const fallback of ['index.d.ts', 'dist/index.d.ts', 'types/index.d.ts', 'lib/index.d.ts']) {
        const candidate = joinAbs(packageRoot, ...fallback.split('/'))
        cache.fileExists(candidate)
      }
      await cache.flushPending(signal)
      for (const fallback of ['index.d.ts', 'dist/index.d.ts', 'types/index.d.ts', 'lib/index.d.ts']) {
        const candidate = joinAbs(packageRoot, ...fallback.split('/'))
        if (cache.readFile(candidate) !== undefined) return candidate
      }
      return undefined
    }
    const parent = parentDirFromPath(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

export function extractImportSpecs(source: string): {
  relative: string[]
  bare: string[]
} {
  const relative = new Set<string>()
  const bare = new Set<string>()
  IMPORT_SPEC_RE.lastIndex = 0
  let match: RegExpExecArray | undefined
  while ((match = IMPORT_SPEC_RE.exec(source) ?? undefined)) {
    const spec = match[1]
    if (!spec) continue
    if (spec.startsWith('.')) relative.add(spec)
    else if (
      !spec.startsWith('data:') &&
      !spec.startsWith('http:') &&
      !spec.startsWith('https:')
    ) {
      bare.add(spec)
    }
  }
  return { relative: [...relative], bare: [...bare] }
}

export function extractTripleSlashRefs(source: string): {
  types: string[]
  paths: string[]
} {
  const types = new Set<string>()
  const paths = new Set<string>()
  TRIPLE_SLASH_RE.lastIndex = 0
  let match: RegExpExecArray | undefined
  while ((match = TRIPLE_SLASH_RE.exec(source) ?? undefined)) {
    const value = match[1]
    if (!value) continue
    const full = match[0] ?? ''
    if (/\btypes\s*=/.test(full)) types.add(value)
    else if (/\bpath\s*=/.test(full)) paths.add(value)
  }
  return { types: [...types], paths: [...paths] }
}

/** 粗略剥离 JSONC 注释与尾逗号 */
export function parseJsonc<T>(raw: string): T | undefined {
  try {
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([\]}])/g, '$1')
    return JSON.parse(stripped) as T
  } catch {
    return undefined
  }
}

/**
 * 同步缓存 + pending 队列：resolveModuleName 只读缓存；
 * 未知路径记入 pending，由 flushPending 经 files-api 填充。
 */
export class FilesResolutionCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly pending = new Set<string>()
  private flushChain: Promise<void> = Promise.resolve()

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
    this.pending.clear()
  }

  /** 清除「不存在」标记，便于 npm install 后重新探测 */
  clearMissing(): void {
    for (const [path, entry] of this.entries) {
      if (entry.kind === 'missing') this.entries.delete(path)
    }
  }

  /** 已确认存在的文件内容（用于注入 Monaco） */
  snapshotFiles(): ResolvedModuleFiles {
    const out = new Map<string, string>()
    for (const [path, entry] of this.entries) {
      if (entry.kind === 'file') out.set(path, entry.content)
    }
    return out
  }

  seedFile(path: string, content: string): void {
    this.entries.set(normalizeAbs(path), { kind: 'file', content })
    this.pending.delete(normalizeAbs(path))
  }

  private touchPending(path: string): void {
    const key = normalizeAbs(path)
    if (this.entries.has(key)) return
    this.pending.add(key)
  }

  fileExists(path: string): boolean {
    const key = normalizeAbs(path)
    const hit = this.entries.get(key)
    if (hit) return hit.kind === 'file'
    this.touchPending(key)
    return false
  }

  directoryExists(path: string): boolean {
    const key = normalizeAbs(path)
    const hit = this.entries.get(key)
    if (hit) return hit.kind === 'folder'
    this.touchPending(key)
    return false
  }

  readFile(path: string): string | undefined {
    const key = normalizeAbs(path)
    const hit = this.entries.get(key)
    if (hit?.kind === 'file') return hit.content
    if (!hit) this.touchPending(key)
    return undefined
  }

  realpath(path: string): string {
    return normalizeAbs(path)
  }

  createHost(): ts.ModuleResolutionHost {
    return {
      fileExists: (p) => this.fileExists(p),
      readFile: (p) => this.readFile(p),
      directoryExists: (p) => this.directoryExists(p),
      realpath: (p) => this.realpath(p),
      getCurrentDirectory: () => '/',
    }
  }

  /**
   * 拉取 pending；同批并行 probe。对 `…/node_modules/<pkg>/…` 在 FSA 读不到时尝试 pnpm 布局回退。
   * 并发 flush 串行化，避免重复 probe。
   * @returns 是否写入了新缓存项
   */
  async flushPending(signal?: AbortSignal): Promise<boolean> {
    let release!: () => void
    const previous = this.flushChain
    this.flushChain = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      if (this.pending.size === 0) return false
      const batch = [...this.pending].slice(0, MAX_PENDING_PER_FLUSH)
      for (const path of batch) this.pending.delete(path)

      const results = await Promise.all(
        batch.map(async (path) => {
          if (signal?.aborted) return false
          if (this.entries.has(path)) return false
          return this.probePath(path, signal)
        }),
      )
      return results.some(Boolean)
    } finally {
      release()
    }
  }

  private async probePath(path: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false

    try {
      const stat = await filesStat(path)
      if (stat?.kind === 'file') {
        const text = await filesReadText(path)
        this.entries.set(path, { kind: 'file', content: text })
        return true
      }
      if (stat?.kind === 'folder') {
        this.entries.set(path, { kind: 'folder' })
        return true
      }
    } catch {
      // fall through to pnpm / missing
    }

    const pnpmFilled = await this.tryFillViaPnpm(path, signal)
    if (pnpmFilled) return true

    this.entries.set(path, { kind: 'missing' })
    return true
  }

  /**
   * 若 path 形如 `…/node_modules/<pkg>/…` 且直接 stat 失败，
   * 在同层 `node_modules/.pnpm` 下找实体并映射到逻辑路径。
   */
  private async tryFillViaPnpm(path: string, signal?: AbortSignal): Promise<boolean> {
    const marker = '/node_modules/'
    const idx = path.lastIndexOf(marker)
    if (idx < 0) return false

    const before = path.slice(0, idx)
    const after = path.slice(idx + marker.length)
    if (after.startsWith('.pnpm/')) return false

    const segments = after.split('/').filter(Boolean)
    if (segments.length === 0) return false

    let pkgName: string
    let rest: string[]
    if (segments[0]?.startsWith('@') && segments.length >= 2) {
      pkgName = `${segments[0]}/${segments[1]}`
      rest = segments.slice(2)
    } else {
      pkgName = segments[0]!
      rest = segments.slice(1)
    }

    const realRoot = await findPnpmPackageRoot(before, pkgName, signal)
    if (!realRoot) return false

    const realPath = rest.length > 0 ? joinAbs(realRoot, ...rest) : realRoot
    try {
      const stat = await filesStat(realPath)
      if (stat?.kind === 'file') {
        const text = await filesReadText(realPath)
        this.entries.set(path, { kind: 'file', content: text })
        return true
      }
      if (stat?.kind === 'folder') {
        this.entries.set(path, { kind: 'folder' })
        return true
      }
    } catch {
      return false
    }
    return false
  }
}

function pnpmFolderPrefixes(packageName: string): string[] {
  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.slice(1).split('/')
    if (scope && name) return [`${scope}+${name}@`]
  }
  return [`${packageName}@`]
}

async function findPnpmPackageRoot(
  projectDir: string,
  packageName: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (signal?.aborted) return undefined
  const pnpmDir = joinAbs(projectDir, 'node_modules', '.pnpm')
  let entries
  try {
    const stat = await filesStat(pnpmDir)
    if (!stat || stat.kind !== 'folder') return undefined
    entries = await filesList(pnpmDir)
  } catch {
    return undefined
  }

  const prefixes = pnpmFolderPrefixes(packageName)
  let scanned = 0
  for (const entry of entries) {
    if (signal?.aborted || scanned >= MAX_PNPM_SCAN) break
    scanned += 1
    if (entry.kind !== 'folder') continue
    if (!prefixes.some((p) => entry.name.startsWith(p))) continue
    const candidate = joinAbs(entry.path, 'node_modules', ...packageNameSegments(packageName))
    try {
      const stat = await filesStat(candidate)
      if (stat?.kind === 'folder') return candidate
    } catch {
      // continue
    }
  }
  return undefined
}

function mapModuleResolution(kind: string | undefined): ts.ModuleResolutionKind {
  switch ((kind ?? '').toLowerCase()) {
    case 'node16':
      return ts.ModuleResolutionKind.Node16
    case 'nodenext':
      return ts.ModuleResolutionKind.NodeNext
    case 'node':
    case 'nodejs':
    case 'node10':
      return ts.ModuleResolutionKind.Node10
    case 'classic':
      return ts.ModuleResolutionKind.Classic
    case 'bundler':
    default:
      return ts.ModuleResolutionKind.Bundler
  }
}

export function toTsCompilerOptions(
  input: ResolveCompilerOptionsInput | undefined,
  configDirectory: string,
): ts.CompilerOptions {
  const baseUrl =
    typeof input?.baseUrl === 'string' && input.baseUrl.trim()
      ? joinAbs(configDirectory, ...input.baseUrl.trim().replace(/^\.\//, '').split('/'))
      : configDirectory

  return {
    // 裸包预解析偏向声明文件，避免落到 index.js 导致命名导出无类型
    allowJs: input?.allowJs === true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: mapModuleResolution(input?.moduleResolution),
    resolveJsonModule: true,
    target: ts.ScriptTarget.ESNext,
    baseUrl,
    ...(input?.paths ? { paths: input.paths } : undefined),
  }
}

function findPackageRootNear(resolvedFile: string, packageName: string | undefined): string | undefined {
  let cursor = parentDirFromPath(resolvedFile)
  for (let i = 0; i < 12; i += 1) {
    if (packageName) {
      const nmSuffix = `/node_modules/${packageName}`
      if (cursor.endsWith(nmSuffix)) return cursor
    } else if (cursor.includes('/node_modules/')) {
      const parts = cursor.split('/node_modules/')
      const tail = parts[parts.length - 1] ?? ''
      const segs = tail.split('/').filter(Boolean)
      if (segs[0]?.startsWith('@') ? segs.length === 2 : segs.length === 1) {
        return cursor
      }
    }
    const parent = parentDirFromPath(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return undefined
}

function typesEntryFromPackageJson(pkg: PackageJsonShape, subpath: string | undefined): string | undefined {
  if (!subpath || subpath === '.') {
    if (typeof pkg.types === 'string' && pkg.types.trim()) return pkg.types.trim()
    if (typeof pkg.typings === 'string' && pkg.typings.trim()) return pkg.typings.trim()
  }

  const exportsField = pkg.exports
  if (!exportsField) return undefined

  const tryKeys = subpath && subpath !== '.' ? [`./${subpath}`, `.${subpath}`] : ['.']

  const pickTypes = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
      return value.endsWith('.d.ts') || value.endsWith('.d.mts') || value.endsWith('.d.cts')
        ? value
        : undefined
    }
    if (!value || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    for (const key of ['types', 'typings']) {
      const hit = record[key]
      if (typeof hit === 'string' && hit.trim()) return hit.trim()
    }
    for (const key of ['import', 'require', 'default', 'node', 'browser']) {
      const nested = pickTypes(record[key])
      if (nested) return nested
    }
    return undefined
  }

  if (typeof exportsField === 'string') {
    return pickTypes(exportsField)
  }

  if (typeof exportsField === 'object' && exportsField !== null) {
    const map = exportsField as Record<string, unknown>
    for (const key of tryKeys) {
      if (key in map) {
        const hit = pickTypes(map[key])
        if (hit) return hit
      }
    }
    if (!subpath || subpath === '.') {
      const hit = pickTypes(map['.'])
      if (hit) return hit
    }
  }
  return undefined
}

/**
 * 若 resolve 落到 JS，尝试改到同包 types / 旁路 .d.ts。
 */
async function preferDeclarationEntry(
  cache: FilesResolutionCache,
  resolvedPath: string,
  moduleName: string,
  signal?: AbortSignal,
): Promise<string> {
  if (isDeclarationPath(resolvedPath)) return resolvedPath
  if (!isJsModulePath(resolvedPath)) return resolvedPath

  const target = resolveTargetSpecifier(moduleName)
  const pkgName = packageNameFromSpecifier(target)
  const packageRoot = findPackageRootNear(resolvedPath, pkgName)
  if (!packageRoot) {
    // 旁路 .d.ts：index.js → index.d.ts
    const siblingDts = resolvedPath.replace(/\.(?:[cm]?js|jsx)$/, '.d.ts')
    cache.fileExists(siblingDts)
    await cache.flushPending(signal)
    if (cache.readFile(siblingDts) !== undefined) return siblingDts
    return resolvedPath
  }

  const pkgJsonPath = joinAbs(packageRoot, 'package.json')
  cache.fileExists(pkgJsonPath)
  await cache.flushPending(signal)
  const pkgRaw = cache.readFile(pkgJsonPath)
  const pkg = pkgRaw ? parseJsonc<PackageJsonShape>(pkgRaw) : undefined

  let subpath: string | undefined
  if (pkgName && target.startsWith(`${pkgName}/`)) {
    subpath = target.slice(pkgName.length + 1)
  }

  const typesEntry = pkg ? typesEntryFromPackageJson(pkg, subpath) : undefined
  if (typesEntry) {
    const typesPath = joinAbs(packageRoot, ...typesEntry.replace(/^\.\//, '').split('/'))
    cache.fileExists(typesPath)
    await cache.flushPending(signal)
    if (cache.readFile(typesPath) !== undefined) return typesPath
  }

  const siblingDts = resolvedPath.replace(/\.(?:[cm]?js|jsx)$/, '.d.ts')
  cache.fileExists(siblingDts)
  await cache.flushPending(signal)
  if (cache.readFile(siblingDts) !== undefined) return siblingDts

  const indexDts = joinAbs(packageRoot, 'index.d.ts')
  cache.fileExists(indexDts)
  await cache.flushPending(signal)
  if (cache.readFile(indexDts) !== undefined) return indexDts

  return resolvedPath
}

/**
 * 用官方 resolveModuleName 解析裸包名；缺失文件时 flush files-api 缓存并重试。
 * JS 入口会尽量回退到声明文件。子路径失败时回退包根。
 */
export async function resolveBareSpecifier(
  cache: FilesResolutionCache,
  containingFile: string,
  moduleName: string,
  compilerOptions: ts.CompilerOptions,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const host = cache.createHost()
  const containing = normalizeAbs(containingFile)
  const target = resolveTargetSpecifier(moduleName)

  await seedPackageJsonForSpecifier(cache, containing, moduleName, signal)

  // Node 内建：优先直达 @types/node/<name>.d.ts
  if (isNodeBuiltinSpecifier(moduleName) || isNodeBuiltinSpecifier(target)) {
    const builtin = normalizeNodeBuiltinSpecifier(moduleName) ?? normalizeNodeBuiltinSpecifier(target)
    if (builtin) {
      const typesRoot = await findTypesNodePackageRoot(cache, containing, signal)
      if (typesRoot) {
        const dtsPath = joinAbs(typesRoot, ...typesNodeBuiltinDtsRel(builtin).split('/'))
        cache.fileExists(dtsPath)
        cache.fileExists(joinAbs(typesRoot, 'package.json'))
        cache.fileExists(joinAbs(typesRoot, 'index.d.ts'))
        await cache.flushPending(signal)
        if (cache.readFile(dtsPath) !== undefined) return dtsPath
        if (cache.readFile(joinAbs(typesRoot, 'index.d.ts')) !== undefined) {
          return joinAbs(typesRoot, 'index.d.ts')
        }
      }
    }
  }

  const tryResolve = async (name: string): Promise<string | undefined> => {
    for (let round = 0; round < MAX_RESOLVE_ROUNDS; round += 1) {
      if (signal?.aborted) return undefined

      const result = ts.resolveModuleName(name, containing, compilerOptions, host)
      const resolved = result.resolvedModule?.resolvedFileName
      if (resolved) {
        let path = normalizeAbs(resolved)
        seedPackageJsonAlongResolved(cache, path, name)
        await cache.flushPending(signal)
        if (cache.readFile(path) === undefined) {
          cache.fileExists(path)
          const changed = await cache.flushPending(signal)
          if (cache.readFile(path) === undefined) {
            if (!changed) return undefined
            continue
          }
        }
        path = await preferDeclarationEntry(cache, path, name, signal)
        return path
      }

      const changed = await cache.flushPending(signal)
      if (!changed) return undefined
    }
    return undefined
  }

  const direct = await tryResolve(target)
  if (direct) return direct

  // exports / scoped 包：resolveModuleName 失败时按 package.json 直达 types
  const directTypes = await resolvePackageTypesEntryDirect(cache, containing, moduleName, signal)
  if (directTypes) return directTypes

  // electron/main 等子路径：回退包根，让 ambient declare module 进入 program
  const pkg = packageNameFromSpecifier(target)
  if (pkg && pkg !== target) {
    const rootResolved = await tryResolve(pkg)
    if (rootResolved) return rootResolved
    const rootDirect = await resolvePackageTypesEntryDirect(cache, containing, pkg, signal)
    if (rootDirect) return rootDirect
  }

  // Node 内建 / 无自带 types 的包 → @types/*
  if (isNodeBuiltinSpecifier(moduleName) || isNodeBuiltinSpecifier(target)) {
    return tryResolve('@types/node')
  }

  if (pkg && !pkg.startsWith('@types/')) {
    const typesPkg = typesPackageName(pkg)
    return tryResolve(typesPkg)
  }

  return undefined
}

/** 沿解析结果向上标记 package.json，便于注入 exports/types */
function seedPackageJsonAlongResolved(
  cache: FilesResolutionCache,
  resolvedFile: string,
  moduleName: string,
): void {
  const pkg = packageNameFromSpecifier(resolveTargetSpecifier(moduleName))
  let cursor = parentDirFromPath(resolvedFile)
  for (let i = 0; i < 10; i += 1) {
    cache.fileExists(joinAbs(cursor, 'package.json'))
    if (pkg) {
      const nmSuffix = `/node_modules/${pkg}`
      if (cursor.endsWith(nmSuffix)) break
    }
    const parent = parentDirFromPath(cursor)
    if (parent === cursor) break
    cursor = parent
  }
}

/**
 * 解析成功后，把包内入口 .d.ts / package.json、相对引用、裸 import、三斜线引用收进 out。
 */
export async function collectResolvedPackageFiles(
  cache: FilesResolutionCache,
  resolvedFile: string,
  out: ResolvedModuleFiles,
  signal?: AbortSignal,
  maxFiles = 40,
  compilerOptions?: ts.CompilerOptions,
  containingFile?: string,
): Promise<void> {
  const queue: string[] = [normalizeAbs(resolvedFile)]
  const visited = new Set<string>()
  const pendingBare: string[] = []
  let bareResolved = 0

  // 一并挂上沿路径的 package.json
  let cursor = parentDirFromPath(resolvedFile)
  for (let i = 0; i < 10; i += 1) {
    const pkgJson = joinAbs(cursor, 'package.json')
    cache.fileExists(pkgJson)
    const parent = parentDirFromPath(cursor)
    if (parent === cursor) break
    if (cursor.includes('/node_modules/')) {
      queue.push(pkgJson)
      const parts = cursor.split('/node_modules/')
      const tail = parts[parts.length - 1] ?? ''
      const segs = tail.split('/').filter(Boolean)
      if (segs[0]?.startsWith('@') ? segs.length <= 2 : segs.length <= 1) {
        break
      }
    }
    cursor = parent
  }

  await cache.flushPending(signal)

  // 确保包根 package.json 一定进入 out（exports 包必需）
  const ensurePkgJson = async (fromPath: string) => {
    let cursor = parentDirFromPath(fromPath)
    for (let i = 0; i < 10; i += 1) {
      if (cursor.includes('/node_modules/')) {
        const parts = cursor.split('/node_modules/')
        const tail = parts[parts.length - 1] ?? ''
        const segs = tail.split('/').filter(Boolean)
        const atRoot = segs[0]?.startsWith('@') ? segs.length <= 2 : segs.length <= 1
        if (atRoot) {
          const pkgJson = joinAbs(cursor, 'package.json')
          let text = cache.readFile(pkgJson)
          if (text === undefined) {
            cache.fileExists(pkgJson)
            await cache.flushPending(signal)
            text = cache.readFile(pkgJson)
          }
          if (text !== undefined) out.set(pkgJson, text)
          return
        }
      }
      const parent = parentDirFromPath(cursor)
      if (parent === cursor) break
      cursor = parent
    }
  }
  await ensurePkgJson(normalizeAbs(resolvedFile))

  const options =
    compilerOptions ??
    ({
      allowJs: false,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      resolveJsonModule: true,
      target: ts.ScriptTarget.ESNext,
      baseUrl: '/',
    } satisfies ts.CompilerOptions)

  const containing = containingFile ? normalizeAbs(containingFile) : normalizeAbs(resolvedFile)

  while ((queue.length > 0 || pendingBare.length > 0) && out.size < maxFiles) {
    if (signal?.aborted) return

    if (queue.length === 0 && pendingBare.length > 0 && bareResolved < MAX_TRANSITIVE_BARE) {
      const bareSpec = pendingBare.shift()
      if (!bareSpec) continue
      bareResolved += 1
      const resolved = await resolveBareSpecifier(cache, containing, bareSpec, options, signal)
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved)
      }
      continue
    }

    const path = queue.shift()
    if (!path || visited.has(path)) continue
    visited.add(path)

    let text = cache.readFile(path)
    if (text === undefined) {
      cache.fileExists(path)
      await cache.flushPending(signal)
      text = cache.readFile(path)
    }
    if (text === undefined) continue
    out.set(path, text)

    if (!path.endsWith('.d.ts') && !path.endsWith('.ts') && !path.endsWith('.tsx') && !path.endsWith('.d.mts') && !path.endsWith('.d.cts')) {
      continue
    }

    const { relative, bare } = extractImportSpecs(text)
    const refs = extractTripleSlashRefs(text)
    const fromDir = parentDirFromPath(path)

    for (const spec of relative) {
      if (out.size >= maxFiles) break
      const base = resolveRelativePath(fromDir, spec)
      for (const candidate of relativeCandidates(base)) {
        cache.fileExists(candidate)
      }
    }
    for (const refPath of refs.paths) {
      if (refPath.startsWith('.')) {
        const base = resolveRelativePath(fromDir, refPath)
        for (const candidate of relativeCandidates(base)) {
          cache.fileExists(candidate)
        }
      }
    }
    await cache.flushPending(signal)

    for (const spec of relative) {
      if (out.size >= maxFiles) break
      const base = resolveRelativePath(fromDir, spec)
      for (const candidate of relativeCandidates(base)) {
        if (cache.fileExists(candidate) && !visited.has(candidate)) {
          queue.push(candidate)
          break
        }
      }
    }
    for (const refPath of refs.paths) {
      if (!refPath.startsWith('.')) continue
      const base = resolveRelativePath(fromDir, refPath)
      for (const candidate of relativeCandidates(base)) {
        if (cache.fileExists(candidate) && !visited.has(candidate)) {
          queue.push(candidate)
          break
        }
      }
    }

    for (const spec of bare) {
      if (bareResolved + pendingBare.length >= MAX_TRANSITIVE_BARE) break
      pendingBare.push(spec)
    }
    for (const typeName of refs.types) {
      if (bareResolved + pendingBare.length >= MAX_TRANSITIVE_BARE) break
      if (typeName === 'node' || typeName === 'node/') {
        pendingBare.push('@types/node')
      } else if (!typeName.startsWith('.')) {
        pendingBare.push(typeName.startsWith('@types/') ? typeName : typesPackageName(typeName))
      }
    }
  }
}

function resolveRelativePath(fromDir: string, spec: string): string {
  const baseSegments = fromDir === '/' ? [] : fromDir.replace(/^\//, '').split('/')
  for (const part of spec.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      baseSegments.pop()
      continue
    }
    baseSegments.push(part)
  }
  return `/${baseSegments.join('/')}`
}

function relativeCandidates(base: string): string[] {
  const out: string[] = []
  if (/\.[cm]?[jt]sx?$/.test(base) || base.endsWith('.d.ts') || base.endsWith('.json')) {
    out.push(base)
  }
  for (const suffix of [
    '.d.ts',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '/index.d.ts',
    '/index.ts',
    '/index.js',
    '.d.mts',
    '.d.cts',
  ]) {
    out.push(`${base}${suffix}`)
  }
  return out
}

export type NearestTsconfig = {
  configDirectory: string
  compilerOptions: ResolveCompilerOptionsInput
  rawExtends?: string
}

type TsconfigFileShape = {
  compilerOptions?: ResolveCompilerOptionsInput & Record<string, unknown>
  extends?: string
}

/**
 * 从文件所在目录向上查找最近的 tsconfig.json / tsconfig.app.json。
 */
export async function loadNearestTsconfig(
  fromFilePath: string,
  cache: FilesResolutionCache,
  signal?: AbortSignal,
): Promise<NearestTsconfig | undefined> {
  let dir = parentDirFromPath(normalizeAbs(fromFilePath))
  const seen = new Set<string>()

  while (!seen.has(dir)) {
    if (signal?.aborted) return undefined
    seen.add(dir)

    for (const name of ['tsconfig.app.json', 'tsconfig.json', 'jsconfig.json']) {
      const path = joinAbs(dir, name)
      cache.fileExists(path)
      await cache.flushPending(signal)
      const raw = cache.readFile(path)
      if (!raw) continue
      const parsed = parseJsonc<TsconfigFileShape>(raw)
      if (!parsed) continue

      let options = parsed.compilerOptions
      if (!options && typeof parsed.extends === 'string' && parsed.extends.trim()) {
        const extendsRel = parsed.extends.trim().replace(/^\.\//, '')
        const extendsPath = joinAbs(dir, ...extendsRel.split('/'))
        const candidates = extendsPath.endsWith('.json')
          ? [extendsPath]
          : [extendsPath, `${extendsPath}.json`]
        for (const candidate of candidates) {
          cache.fileExists(candidate)
        }
        await cache.flushPending(signal)
        for (const candidate of candidates) {
          const extendsRaw = cache.readFile(candidate)
          if (!extendsRaw) continue
          const extendsParsed = parseJsonc<TsconfigFileShape>(extendsRaw)
          options = extendsParsed?.compilerOptions
          break
        }
      }

      const compilerOptions: ResolveCompilerOptionsInput = {
        baseUrl: typeof options?.baseUrl === 'string' ? options.baseUrl : undefined,
        paths:
          options?.paths && typeof options.paths === 'object'
            ? (options.paths as Record<string, string[]>)
            : undefined,
        moduleResolution:
          typeof options?.moduleResolution === 'string' ? options.moduleResolution : undefined,
        allowJs: typeof options?.allowJs === 'boolean' ? options.allowJs : undefined,
      }

      return {
        configDirectory: dir,
        compilerOptions,
        rawExtends: typeof parsed.extends === 'string' ? parsed.extends : undefined,
      }
    }

    const parent = parentDirFromPath(dir)
    if (parent === dir) break
    dir = parent
  }

  return undefined
}
