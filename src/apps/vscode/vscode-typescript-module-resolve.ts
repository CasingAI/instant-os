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

/** from / import() / require / 无副作用 import */
const IMPORT_SPEC_RE =
  /(?:from\s+|import\s*\(|require\s*\(|import\s+)\s*['"]([^'"]+)['"]/g

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

/** scoped `@foo/bar` → `@types/foo__bar`；普通包 → `@types/pkg` */
export function typesPackageName(packageName: string): string {
  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.slice(1).split('/')
    if (scope && name) return `@types/${scope}__${name}`
  }
  return `@types/${packageName}`
}

/** 从完整 specifier 取出包名（`@scope/pkg/sub` → `@scope/pkg`） */
export function packageNameFromSpecifier(specifier: string): string | undefined {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return undefined
  if (specifier.startsWith('node:') || specifier.startsWith('data:') || specifier.startsWith('http')) {
    return undefined
  }
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    if (parts.length < 2) return undefined
    return `${parts[0]}/${parts[1]}`
  }
  return specifier.split('/')[0]
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
      !spec.startsWith('node:') &&
      !spec.startsWith('data:') &&
      !spec.startsWith('http:') &&
      !spec.startsWith('https:')
    ) {
      bare.add(spec)
    }
  }
  return { relative: [...relative], bare: [...bare] }
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
   * 拉取 pending；对 `…/node_modules/<pkg>/…` 在 FSA 读不到时尝试 pnpm 布局回退。
   * @returns 是否写入了新缓存项
   */
  async flushPending(signal?: AbortSignal): Promise<boolean> {
    if (this.pending.size === 0) return false
    let changed = false
    const batch = [...this.pending].slice(0, MAX_PENDING_PER_FLUSH)
    for (const path of batch) {
      if (signal?.aborted) break
      this.pending.delete(path)
      if (this.entries.has(path)) continue

      const filled = await this.probePath(path, signal)
      if (filled) changed = true
    }
    return changed
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
    allowJs: input?.allowJs !== false,
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

/**
 * 用官方 resolveModuleName 解析裸包名；缺失文件时 flush files-api 缓存并重试。
 * @returns 解析到的主文件绝对路径（若成功）
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

  for (let round = 0; round < MAX_RESOLVE_ROUNDS; round += 1) {
    if (signal?.aborted) return undefined

    const result = ts.resolveModuleName(moduleName, containing, compilerOptions, host)
    const resolved = result.resolvedModule?.resolvedFileName
    if (resolved) {
      const path = normalizeAbs(resolved)
      seedPackageJsonAlongResolved(cache, path, moduleName)
      if (cache.readFile(path) !== undefined) {
        await cache.flushPending(signal)
        return path
      }
      cache.fileExists(path)
      const changed = await cache.flushPending(signal)
      if (cache.readFile(path) !== undefined) return path
      if (!changed) return undefined
      continue
    }

    const changed = await cache.flushPending(signal)
    if (!changed) return undefined
  }
  return undefined
}

/** 沿解析结果向上标记 package.json，便于注入 exports/types */
function seedPackageJsonAlongResolved(
  cache: FilesResolutionCache,
  resolvedFile: string,
  moduleName: string,
): void {
  const pkg = packageNameFromSpecifier(moduleName)
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
 * 解析成功后，把包内入口 .d.ts / package.json 及有限相对引用收进 out。
 */
export async function collectResolvedPackageFiles(
  cache: FilesResolutionCache,
  resolvedFile: string,
  out: ResolvedModuleFiles,
  signal?: AbortSignal,
  maxFiles = 40,
): Promise<void> {
  const queue: string[] = [normalizeAbs(resolvedFile)]
  const visited = new Set<string>()

  // 一并挂上沿路径的 package.json
  let cursor = parentDirFromPath(resolvedFile)
  for (let i = 0; i < 10; i += 1) {
    const pkgJson = joinAbs(cursor, 'package.json')
    cache.fileExists(pkgJson)
    const parent = parentDirFromPath(cursor)
    if (parent === cursor) break
    if (cursor.includes('/node_modules/')) {
      queue.push(pkgJson)
      // 停在包根（node_modules/<pkg> 或 node_modules/@scope/pkg）
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

  while (queue.length > 0 && out.size < maxFiles) {
    if (signal?.aborted) return
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

    if (!path.endsWith('.d.ts') && !path.endsWith('.ts') && !path.endsWith('.tsx')) continue

    const { relative } = extractImportSpecs(text)
    const fromDir = parentDirFromPath(path)
    for (const spec of relative) {
      if (out.size >= maxFiles) break
      const base = resolveRelativePath(fromDir, spec)
      for (const candidate of relativeCandidates(base)) {
        cache.fileExists(candidate)
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
        // extends 可能省略 .json
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
