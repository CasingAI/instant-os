/**
 * 与 tsserver 同源的模块解析：从导入文件目录出发，经 TypeScript resolveModuleName
 * + files-api 异步缓存，向上查找 node_modules（含 pnpm / @types 尽力回退）。
 */
import ts from 'typescript'
import { filesList, filesReadText, filesStat } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { parentDirFromPath } from '../../monaco/monaco-language.ts'

const MAX_RESOLVE_ROUNDS = 24
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
  | { kind: 'file-meta' }
  | { kind: 'folder' }
  | { kind: 'missing' }

export type FilesResolutionCacheMetrics = {
  probeCount: number
  readCount: number
  pnpmListCount: number
}

const MAX_PENDING_PER_FLUSH = 96
const MAX_FLUSH_LOOPS = 32

function pendingPathPriority(path: string): number {
  if (path.endsWith('/package.json') || path.endsWith('package.json')) return 0
  if (path.endsWith('.d.ts') || path.endsWith('.d.mts') || path.endsWith('.d.cts')) return 1
  if (path.endsWith('tsconfig.json') || path.endsWith('tsconfig.app.json') || path.endsWith('jsconfig.json')) {
    return 1
  }
  if (/\.(?:[cm]?js|jsx)$/.test(path)) return 2
  return 3
}

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

/**
 * 真实 TS：exports/main 落到 .js 后旁路找同路径声明。
 * `foo.js` → `foo.d.ts`；`.mjs` → `.d.mts`；`.cjs` → `.d.cts`。
 */
export function declarationPathBesideJs(jsPath: string): string | undefined {
  const trimmed = jsPath.trim()
  if (trimmed.endsWith('.mjs')) return `${trimmed.slice(0, -4)}.d.mts`
  if (trimmed.endsWith('.cjs')) return `${trimmed.slice(0, -4)}.d.cts`
  if (trimmed.endsWith('.jsx')) return `${trimmed.slice(0, -4)}.d.ts`
  if (trimmed.endsWith('.js')) return `${trimmed.slice(0, -3)}.d.ts`
  return undefined
}

/** 包内相对路径 → 绝对路径（去掉前导 ./） */
function packageRelToAbs(packageRoot: string, rel: string): string {
  return joinAbs(packageRoot, ...rel.replace(/^\.\//, '').split('/').filter(Boolean))
}

/**
 * 从 exports / main / module 收集 JS 入口（供预热与旁路 .d.ts）。
 */
function jsEntryCandidatesFromPackageJson(
  pkg: PackageJsonShape,
  subpath: string | undefined,
): string[] {
  const out: string[] = []
  const pushIfJs = (value: unknown) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed && isJsModulePath(trimmed)) out.push(trimmed)
  }

  const walkExport = (value: unknown) => {
    if (typeof value === 'string') {
      pushIfJs(value)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    for (const key of ['import', 'require', 'default', 'node', 'browser', 'module']) {
      walkExport(record[key])
    }
  }

  const exportsField = pkg.exports
  if (exportsField) {
    const tryKeys = subpath && subpath !== '.' ? [`./${subpath}`, `.${subpath}`] : ['.']
    if (typeof exportsField === 'string') {
      walkExport(exportsField)
    } else if (typeof exportsField === 'object') {
      const map = exportsField as Record<string, unknown>
      for (const key of tryKeys) {
        if (key in map) walkExport(map[key])
      }
      if (!subpath || subpath === '.') walkExport(map['.'])
    }
  }

  if (!subpath || subpath === '.') {
    pushIfJs(pkg.module)
    pushIfJs(pkg.main)
  }

  return [...new Set(out)]
}

/**
 * 预热包入口 JS 与旁路 .d.ts，让后续 resolveModuleName 少轮次失败。
 */
function seedPackageEntryFiles(
  cache: FilesResolutionCache,
  packageRoot: string,
  pkg: PackageJsonShape,
  subpath: string | undefined,
): void {
  const typesEntry = typesEntryFromPackageJson(pkg, subpath)
  if (typesEntry) cache.fileExists(packageRelToAbs(packageRoot, typesEntry))

  for (const jsRel of jsEntryCandidatesFromPackageJson(pkg, subpath)) {
    cache.fileExists(packageRelToAbs(packageRoot, jsRel))
    const dtsRel = declarationPathBesideJs(jsRel)
    if (dtsRel) cache.fileExists(packageRelToAbs(packageRoot, dtsRel))
  }
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
    if (cache.fileExists(pkgJson)) return candidate
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
    const text = await cache.ensureFileContent(path, signal)
    if (text !== undefined) out.set(path, text)
  }

  if (!cache.fileExists(dtsPath) && !cache.fileExists(indexDts)) {
    return undefined
  }

  // 从 index + 内建 dts 继续展开（配额更高）
  const start = cache.fileExists(dtsPath) ? dtsPath : indexDts
  await collectResolvedPackageFiles(cache, start, out, signal, maxFiles)
  return cache.fileExists(dtsPath) ? dtsPath : start
}

/**
 * 解析前从 containing 向上预热 `node_modules/<pkg>/package.json`，
 * 并预热 exports/main 入口 JS 与旁路 .d.ts，便于 resolveModuleName。
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

  let subpath: string | undefined
  if (target.startsWith(`${pkg}/`)) {
    subpath = target.slice(pkg.length + 1)
  }

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

  dir = parentDirFromPath(normalizeAbs(containingFile))
  for (let i = 0; i < 24; i += 1) {
    if (signal?.aborted) return
    const pkgRoot = joinAbs(dir, 'node_modules', ...packageNameSegments(pkg))
    const pkgJsonPath = joinAbs(pkgRoot, 'package.json')
    const pkgRaw = await cache.ensureFileContent(pkgJsonPath, signal)
    if (pkgRaw !== undefined) {
      const pkgJson = parseJsonc<PackageJsonShape>(pkgRaw)
      if (pkgJson) {
        seedPackageEntryFiles(cache, pkgRoot, pkgJson, subpath)
        await cache.flushPending(signal)
      }
      return
    }
    const parent = parentDirFromPath(dir)
    if (parent === dir) break
    dir = parent
  }
}

/**
 * 不依赖 resolveModuleName：向上找包根 package.json，按 types/exports/main 旁路直达声明入口。
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
    const pkgRaw = await cache.ensureFileContent(pkgJsonPath, signal)
    if (pkgRaw !== undefined) {
      const pkgJson = parseJsonc<PackageJsonShape>(pkgRaw)
      if (pkgJson) {
        seedPackageEntryFiles(cache, packageRoot, pkgJson, subpath)
        await cache.flushPending(signal)

        const typesEntry = typesEntryFromPackageJson(pkgJson, subpath)
        if (typesEntry) {
          const typesPath = packageRelToAbs(packageRoot, typesEntry)
          if (cache.fileExists(typesPath)) return typesPath
        }

        // 再试 exports/main JS 旁路（与 typesEntry 重复时已命中）
        for (const jsRel of jsEntryCandidatesFromPackageJson(pkgJson, subpath)) {
          const dtsRel = declarationPathBesideJs(jsRel)
          if (!dtsRel) continue
          const dtsPath = packageRelToAbs(packageRoot, dtsRel)
          if (cache.fileExists(dtsPath)) return dtsPath
        }
      }

      // 最后补充常见布局（非特例列表，仅兜底）
      for (const fallback of ['index.d.ts', 'dist/index.d.ts', 'types/index.d.ts', 'lib/index.d.ts']) {
        cache.fileExists(joinAbs(packageRoot, ...fallback.split('/')))
      }
      await cache.flushPending(signal)
      for (const fallback of ['index.d.ts', 'dist/index.d.ts', 'types/index.d.ts', 'lib/index.d.ts']) {
        const candidate = joinAbs(packageRoot, ...fallback.split('/'))
        if (cache.fileExists(candidate)) return candidate
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
 * 存在性（file-meta）与正文（file）分离，解析轮次避免全文读取。
 */
export class FilesResolutionCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly pending = new Set<string>()
  private readonly contentPending = new Set<string>()
  private flushChain: Promise<void> = Promise.resolve()
  private readonly metrics: FilesResolutionCacheMetrics = {
    probeCount: 0,
    readCount: 0,
    pnpmListCount: 0,
  }
  /** projectDir → .pnpm 子项名列表；null 表示无 .pnpm */
  private readonly pnpmListingByProject = new Map<string, string[] | undefined>()
  /** `${projectDir}\0${packageName}` → 实体根或 undefined 负向 */
  private readonly pnpmRootByPkg = new Map<string, string | undefined>()

  get size(): number {
    return this.entries.size
  }

  getMetrics(): FilesResolutionCacheMetrics {
    return { ...this.metrics }
  }

  resetMetrics(): void {
    this.metrics.probeCount = 0
    this.metrics.readCount = 0
    this.metrics.pnpmListCount = 0
  }

  clear(): void {
    this.entries.clear()
    this.pending.clear()
    this.contentPending.clear()
    this.pnpmListingByProject.clear()
    this.pnpmRootByPkg.clear()
    this.resetMetrics()
  }

  /** 清除「不存在」标记，便于 npm install 后重新探测 */
  clearMissing(): void {
    for (const [path, entry] of this.entries) {
      if (entry.kind === 'missing') this.entries.delete(path)
    }
    this.pnpmListingByProject.clear()
    this.pnpmRootByPkg.clear()
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
    const key = normalizeAbs(path)
    this.entries.set(key, { kind: 'file', content })
    this.pending.delete(key)
    this.contentPending.delete(key)
  }

  /** 测试 / 预热：标记目录存在，避免 flushPending 误标 missing */
  seedFolder(path: string): void {
    this.entries.set(normalizeAbs(path), { kind: 'folder' })
    this.pending.delete(normalizeAbs(path))
  }

  private touchPending(path: string): void {
    const key = normalizeAbs(path)
    if (this.entries.has(key)) return
    this.pending.add(key)
  }

  private touchContentPending(path: string): void {
    const key = normalizeAbs(path)
    const hit = this.entries.get(key)
    if (hit?.kind === 'file') return
    if (hit?.kind === 'missing' || hit?.kind === 'folder') return
    this.contentPending.add(key)
  }

  fileExists(path: string): boolean {
    const key = normalizeAbs(path)
    const hit = this.entries.get(key)
    if (hit) return hit.kind === 'file' || hit.kind === 'file-meta'
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
    if (hit?.kind === 'file-meta') {
      this.touchContentPending(key)
      return undefined
    }
    if (!hit) this.touchPending(key)
    return undefined
  }

  /**
   * 确保路径有正文；file-meta 时读入，未探测时先 probe。
   * @returns 文件正文，不存在则 undefined
   */
  async ensureFileContent(path: string, signal?: AbortSignal): Promise<string | undefined> {
    const key = normalizeAbs(path)
    const hit = this.entries.get(key)
    if (hit?.kind === 'file') return hit.content
    if (hit?.kind === 'missing' || hit?.kind === 'folder') return undefined

    if (!hit) {
      this.touchPending(key)
      await this.flushPending(signal)
    }

    const after = this.entries.get(key)
    if (after?.kind === 'file') return after.content
    if (after?.kind === 'file-meta') {
      this.touchContentPending(key)
      await this.flushPending(signal)
      const loaded = this.entries.get(key)
      return loaded?.kind === 'file' ? loaded.content : undefined
    }
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
   * 拉取 pending（存在性）与 contentPending（正文）。
   * 优先 package.json / .d.ts；循环直到队列空或达上限。
   */
  async flushPending(signal?: AbortSignal): Promise<boolean> {
    let release!: () => void
    const previous = this.flushChain
    this.flushChain = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      let any = false
      for (let loop = 0; loop < MAX_FLUSH_LOOPS; loop += 1) {
        if (signal?.aborted) break
        if (this.pending.size === 0 && this.contentPending.size === 0) break

        if (this.pending.size > 0) {
          const sorted = [...this.pending].sort(
            (a, b) => pendingPathPriority(a) - pendingPathPriority(b),
          )
          const batch = sorted.slice(0, MAX_PENDING_PER_FLUSH)
          for (const path of batch) this.pending.delete(path)

          const results = await Promise.all(
            batch.map(async (path) => {
              if (signal?.aborted) return false
              if (this.entries.has(path)) return false
              return this.probePath(path, signal)
            }),
          )
          if (results.some(Boolean)) any = true
        }

        if (this.contentPending.size > 0) {
          const batch = [...this.contentPending].slice(0, MAX_PENDING_PER_FLUSH)
          for (const path of batch) this.contentPending.delete(path)
          const results = await Promise.all(
            batch.map(async (path) => {
              if (signal?.aborted) return false
              return this.loadFileContent(path, signal)
            }),
          )
          if (results.some(Boolean)) any = true
        }
      }
      return any
    } finally {
      release()
    }
  }

  private async loadFileContent(path: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false
    const hit = this.entries.get(path)
    if (hit?.kind === 'file') return false
    if (hit?.kind === 'missing' || hit?.kind === 'folder') return false

    try {
      this.metrics.readCount += 1
      const text = await filesReadText(path)
      this.entries.set(path, { kind: 'file', content: text })
      return true
    } catch {
      if (!hit) this.entries.set(path, { kind: 'missing' })
      return true
    }
  }

  private async probePath(path: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false
    this.metrics.probeCount += 1

    try {
      const stat = await filesStat(path)
      if (stat?.kind === 'file') {
        this.entries.set(path, { kind: 'file-meta' })
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

    // 已确认无 .pnpm 则跳过
    if (this.pnpmListingByProject.has(before) && this.pnpmListingByProject.get(before) === undefined) {
      return false
    }

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

    const realRoot = await this.findPnpmPackageRootCached(before, pkgName, signal)
    if (!realRoot) return false

    const realPath = rest.length > 0 ? joinAbs(realRoot, ...rest) : realRoot
    try {
      this.metrics.probeCount += 1
      const stat = await filesStat(realPath)
      if (stat?.kind === 'file') {
        this.entries.set(path, { kind: 'file-meta' })
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

  private async findPnpmPackageRootCached(
    projectDir: string,
    packageName: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const rootKey = `${projectDir}\0${packageName}`
    if (this.pnpmRootByPkg.has(rootKey)) {
      return this.pnpmRootByPkg.get(rootKey)
    }

    if (signal?.aborted) return undefined
    const pnpmDir = joinAbs(projectDir, 'node_modules', '.pnpm')

    let names = this.pnpmListingByProject.get(projectDir)
    if (!this.pnpmListingByProject.has(projectDir)) {
      try {
        this.metrics.probeCount += 1
        const stat = await filesStat(pnpmDir)
        if (!stat || stat.kind !== 'folder') {
          this.pnpmListingByProject.set(projectDir, undefined)
          this.pnpmRootByPkg.set(rootKey, undefined)
          return undefined
        }
        this.metrics.pnpmListCount += 1
        const entries = await filesList(pnpmDir)
        names = entries.filter((e) => e.kind === 'folder').map((e) => e.name)
        this.pnpmListingByProject.set(projectDir, names)
      } catch {
        this.pnpmListingByProject.set(projectDir, undefined)
        this.pnpmRootByPkg.set(rootKey, undefined)
        return undefined
      }
    }

    if (!names || names.length === 0) {
      this.pnpmRootByPkg.set(rootKey, undefined)
      return undefined
    }

    const prefixes = pnpmFolderPrefixes(packageName)
    let scanned = 0
    for (const name of names) {
      if (signal?.aborted || scanned >= MAX_PNPM_SCAN) break
      scanned += 1
      if (!prefixes.some((p) => name.startsWith(p))) continue
      const candidate = joinAbs(pnpmDir, name, 'node_modules', ...packageNameSegments(packageName))
      try {
        this.metrics.probeCount += 1
        const stat = await filesStat(candidate)
        if (stat?.kind === 'folder') {
          this.pnpmRootByPkg.set(rootKey, candidate)
          return candidate
        }
      } catch {
        // continue
      }
    }
    this.pnpmRootByPkg.set(rootKey, undefined)
    return undefined
  }
}

function pnpmFolderPrefixes(packageName: string): string[] {
  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.slice(1).split('/')
    if (scope && name) return [`${scope}+${name}@`]
  }
  return [`${packageName}@`]
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

/**
 * 与真实 TS 一致：优先 types/typings；否则从 exports/main/module 的 JS 入口旁路到 .d.ts。
 */
export function typesEntryFromPackageJson(
  pkg: PackageJsonShape,
  subpath: string | undefined,
): string | undefined {
  if (!subpath || subpath === '.') {
    if (typeof pkg.types === 'string' && pkg.types.trim()) return pkg.types.trim()
    if (typeof pkg.typings === 'string' && pkg.typings.trim()) return pkg.typings.trim()
  }

  const pickTypes = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return undefined
      if (isDeclarationPath(trimmed)) return trimmed
      if (isJsModulePath(trimmed)) return declarationPathBesideJs(trimmed)
      return undefined
    }
    if (!value || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    for (const key of ['types', 'typings']) {
      const hit = record[key]
      if (typeof hit === 'string' && hit.trim()) return hit.trim()
    }
    for (const key of ['import', 'require', 'default', 'node', 'browser', 'module']) {
      const nested = pickTypes(record[key])
      if (nested) return nested
    }
    return undefined
  }

  const exportsField = pkg.exports
  if (exportsField) {
    const tryKeys = subpath && subpath !== '.' ? [`./${subpath}`, `.${subpath}`] : ['.']

    if (typeof exportsField === 'string') {
      const hit = pickTypes(exportsField)
      if (hit) return hit
    } else if (typeof exportsField === 'object' && exportsField !== null) {
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
  }

  if (!subpath || subpath === '.') {
    for (const field of [pkg.module, pkg.main]) {
      if (typeof field !== 'string' || !field.trim()) continue
      const hit = pickTypes(field.trim())
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
    const siblingDts = declarationPathBesideJs(resolvedPath)
    if (siblingDts) {
      cache.fileExists(siblingDts)
      await cache.flushPending(signal)
      if (cache.fileExists(siblingDts)) return siblingDts
    }
    return resolvedPath
  }

  const pkgJsonPath = joinAbs(packageRoot, 'package.json')
  cache.fileExists(pkgJsonPath)
  await cache.flushPending(signal)
  const pkgRaw = await cache.ensureFileContent(pkgJsonPath, signal)
  const pkg = pkgRaw ? parseJsonc<PackageJsonShape>(pkgRaw) : undefined

  let subpath: string | undefined
  if (pkgName && target.startsWith(`${pkgName}/`)) {
    subpath = target.slice(pkgName.length + 1)
  }

  if (pkg) {
    seedPackageEntryFiles(cache, packageRoot, pkg, subpath)
    await cache.flushPending(signal)
  }

  const typesEntry = pkg ? typesEntryFromPackageJson(pkg, subpath) : undefined
  if (typesEntry) {
    const typesPath = packageRelToAbs(packageRoot, typesEntry)
    if (cache.fileExists(typesPath)) return typesPath
  }

  const siblingDts = declarationPathBesideJs(resolvedPath)
  if (siblingDts) {
    cache.fileExists(siblingDts)
    await cache.flushPending(signal)
    if (cache.fileExists(siblingDts)) return siblingDts
  }

  const indexDts = joinAbs(packageRoot, 'index.d.ts')
  cache.fileExists(indexDts)
  await cache.flushPending(signal)
  if (cache.fileExists(indexDts)) return indexDts

  return resolvedPath
}

/**
 * 用官方 resolveModuleName 解析裸包名；缺失文件时 flush files-api 缓存并重试。
 * 先直达 package.json types/旁路 .d.ts，再走重型 resolveModuleName。
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
        if (cache.fileExists(dtsPath)) return dtsPath
        if (cache.fileExists(joinAbs(typesRoot, 'index.d.ts'))) {
          return joinAbs(typesRoot, 'index.d.ts')
        }
      }
    }
  }

  // 先直达：多数 exports 包可跳过大量 failedLookup FSA probe
  const directTypesEarly = await resolvePackageTypesEntryDirect(cache, containing, moduleName, signal)
  if (directTypesEarly) return directTypesEarly

  const tryResolve = async (name: string): Promise<string | undefined> => {
    for (let round = 0; round < MAX_RESOLVE_ROUNDS; round += 1) {
      if (signal?.aborted) return undefined

      const result = ts.resolveModuleName(name, containing, compilerOptions, host)
      const resolved = result.resolvedModule?.resolvedFileName
      if (resolved) {
        let path = normalizeAbs(resolved)
        seedPackageJsonAlongResolved(cache, path, name)
        await cache.flushPending(signal)
        if (!cache.fileExists(path)) {
          cache.fileExists(path)
          const changed = await cache.flushPending(signal)
          if (!cache.fileExists(path)) {
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

  const viaResolve = await tryResolve(target)
  if (viaResolve) return viaResolve

  // electron/main 等子路径：回退包根，让 ambient declare module 进入 program
  const pkg = packageNameFromSpecifier(target)
  if (pkg && pkg !== target) {
    const rootDirect = await resolvePackageTypesEntryDirect(cache, containing, pkg, signal)
    if (rootDirect) return rootDirect
    const rootResolved = await tryResolve(pkg)
    if (rootResolved) return rootResolved
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
          const text = await cache.ensureFileContent(pkgJson, signal)
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

    const text = await cache.ensureFileContent(path, signal)
    if (text === undefined) continue
    out.set(path, text)

    if (!path.endsWith('.d.ts') && !path.endsWith('.ts') && !path.endsWith('.tsx') && !path.endsWith('.d.mts') && !path.endsWith('.d.cts')) {
      continue
    }

    const { relative } = extractImportSpecs(text)
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

    for (const typeName of refs.types) {
      if (bareResolved + pendingBare.length >= MAX_TRANSITIVE_BARE) break
      if (typeName === 'node' || typeName === 'node/') {
        pendingBare.push('@types/node')
      } else if (!typeName.startsWith('.')) {
        pendingBare.push(typeName.startsWith('@types/') ? typeName : typesPackageName(typeName))
      }
    }
    // 不展开 .d.ts 内裸 import，避免大包传递依赖拖垮收集；入口 paths 映射已够 Monaco 解包名
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
      const raw = await cache.ensureFileContent(path, signal)
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
          const extendsRaw = await cache.ensureFileContent(candidate, signal)
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
