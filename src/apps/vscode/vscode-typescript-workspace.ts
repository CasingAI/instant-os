import { filesList, filesReadText, filesStat } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { disposeMonacoModelForPath, ensureMonacoPathModel } from '../../monaco/monaco-editor.tsx'
import { monacoLanguageFromFileName, parentDirFromPath } from '../../monaco/monaco-language.ts'
import { ensureMonacoEnvironment } from '../../monaco/monaco-setup.ts'
import {
  applyMonacoTypescriptCompilerOverrides,
  clearMonacoTypescriptExtraLibs,
  MonacoModuleResolutionKind,
  monacoFileUriString,
  refreshMonacoTypescriptSemantics,
  setMonacoTypescriptExtraLibs,
  type MonacoTypescriptCompilerOverrides,
} from '../../monaco/monaco-typescript.ts'

const MAX_DTS_FILES_PER_PACKAGE = 80
const MAX_WALK_DEPTH = 5
const MAX_TOTAL_LIBS = 400
const MAX_LOCAL_MODULE_FILES = 80
const MAX_LOCAL_MODULE_DEPTH = 8
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.cache'])

const RELATIVE_SPEC_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.d.ts',
  '/index.js',
  '/index.jsx',
] as const

/** 匹配 from/import()/require()，以及无副作用 `import './x'` */
const RELATIVE_IMPORT_RE =
  /(?:from\s+|import\s*\(|require\s*\(|import\s+)\s*['"](\.[^'"]+)['"]/g

/** 工作区内为相对路径解析而加载的 Monaco model 路径 */
const localModuleModelPaths = new Set<string>()

/** 编排 sync 代数：文本编辑时用它丢弃过期结果，而非中途 abort BFS */
let typescriptSyncGeneration = 0

export type VscodeTypescriptSyncEntry = {
  path: string
  text: string
}

type PackageJsonShape = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  types?: string
  typings?: string
  exports?: unknown
}

type TsconfigShape = {
  compilerOptions?: {
    jsxImportSource?: string
    baseUrl?: string
    paths?: Record<string, string[]>
    moduleResolution?: string
    allowImportingTsExtensions?: boolean
  }
  references?: { path?: string }[]
  extends?: string
}

function joinWorkspace(workspaceFolder: string, ...segments: string[]): string {
  return joinFilesAbsolutePath(workspaceFolder.replace(/\/+$/, '') || '/', ...segments)
}

function packageDirSegments(packageName: string): string[] {
  return packageName.split('/').filter(Boolean)
}

function fileNameFromAbsolutePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

async function tryReadText(path: string): Promise<string | undefined> {
  try {
    const stat = await filesStat(path)
    if (!stat || stat.kind !== 'file') return undefined
    return await filesReadText(path)
  } catch {
    return undefined
  }
}

/** 粗略剥离 JSONC 注释与尾逗号，足够读 tsconfig / package.json */
function parseJsonc<T>(raw: string): T | undefined {
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

function collectDependencyNames(pkg: PackageJsonShape): string[] {
  const names = new Set<string>()
  for (const key of Object.keys(pkg.dependencies ?? {})) names.add(key)
  for (const key of Object.keys(pkg.devDependencies ?? {})) names.add(key)
  return [...names].sort()
}

function resolveTypesEntry(pkg: PackageJsonShape): string | undefined {
  if (typeof pkg.types === 'string' && pkg.types.trim()) return pkg.types.trim()
  if (typeof pkg.typings === 'string' && pkg.typings.trim()) return pkg.typings.trim()

  const exportsField = pkg.exports
  if (!exportsField || typeof exportsField !== 'object') return undefined

  const root = (exportsField as Record<string, unknown>)['.']
  if (typeof root === 'string' && root.endsWith('.d.ts')) return root
  if (root && typeof root === 'object') {
    const typed = root as Record<string, unknown>
    for (const key of ['types', 'typings', 'default']) {
      const value = typed[key]
      if (typeof value === 'string' && value.includes('.d.ts')) return value
      if (value && typeof value === 'object') {
        const nested = value as Record<string, unknown>
        if (typeof nested.types === 'string') return nested.types
      }
    }
  }
  return undefined
}

async function collectDtsInPackage(
  packageRoot: string,
  out: Map<string, string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let count = 0

  async function addFile(path: string): Promise<void> {
    if (out.has(path) || out.size >= MAX_TOTAL_LIBS || count >= MAX_DTS_FILES_PER_PACKAGE) return
    const text = await tryReadText(path)
    if (text === undefined) return
    out.set(path, text)
    count += 1
  }

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (signal?.aborted) return
    if (depth > MAX_WALK_DEPTH || count >= MAX_DTS_FILES_PER_PACKAGE) return
    if (out.size >= MAX_TOTAL_LIBS) return

    let entries
    try {
      entries = await filesList(dirPath)
    } catch {
      return
    }

    for (const entry of entries) {
      if (signal?.aborted || count >= MAX_DTS_FILES_PER_PACKAGE || out.size >= MAX_TOTAL_LIBS) {
        return
      }

      if (entry.kind === 'folder') {
        if (SKIP_DIR_NAMES.has(entry.name)) continue
        await walk(entry.path, depth + 1)
        continue
      }

      const isDts = entry.name.endsWith('.d.ts')
      const isPackageJson = entry.name === 'package.json'
      if (!isDts && !isPackageJson) continue
      await addFile(entry.path)
    }
  }

  const pkgJsonPath = joinWorkspace(packageRoot, 'package.json')
  const pkgRaw = await tryReadText(pkgJsonPath)
  if (pkgRaw !== undefined && !out.has(pkgJsonPath)) {
    out.set(pkgJsonPath, pkgRaw)
    count += 1
  }

  const pkg = pkgRaw ? parseJsonc<PackageJsonShape>(pkgRaw) : undefined
  const typesEntry = pkg ? resolveTypesEntry(pkg) : undefined

  if (typesEntry) {
    const entryPath = joinWorkspace(packageRoot, ...typesEntry.replace(/^\.\//, '').split('/'))
    await addFile(entryPath)
  }

  for (const fallback of ['index.d.ts', 'types/index.d.ts', 'dist/index.d.ts', 'src/index.d.ts']) {
    if (count >= MAX_DTS_FILES_PER_PACKAGE || out.size >= MAX_TOTAL_LIBS) break
    await addFile(joinWorkspace(packageRoot, ...fallback.split('/')))
  }

  await walk(packageRoot, 0)
}

function compilerOptionsFromTsconfig(
  workspaceFolder: string,
  options: NonNullable<TsconfigShape['compilerOptions']>,
): MonacoTypescriptCompilerOverrides {
  const overrides: MonacoTypescriptCompilerOverrides = {
    baseUrl: monacoFileUriString(workspaceFolder),
    // Monaco 无真实 FS：始终用 Bundler，避免 tsconfig 的 node/node16 导致
    // 无后缀相对路径「能跳转却报 2307」的诊断分裂
    moduleResolution: MonacoModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  }
  if (typeof options.jsxImportSource === 'string' && options.jsxImportSource.trim()) {
    overrides.jsxImportSource = options.jsxImportSource.trim()
  }
  // 仍读取 tsconfig 的 allowImportingTsExtensions；缺省保持 true
  if (typeof options.allowImportingTsExtensions === 'boolean') {
    overrides.allowImportingTsExtensions = options.allowImportingTsExtensions
  }
  if (options.paths && typeof options.paths === 'object') {
    const paths: Record<string, string[]> = {}
    for (const [key, values] of Object.entries(options.paths)) {
      if (!Array.isArray(values)) continue
      paths[key] = values
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.replace(/^\.\//, ''))
    }
    if (Object.keys(paths).length > 0) {
      overrides.paths = paths
    }
  }
  return overrides
}

async function loadTsconfigOverrides(
  workspaceFolder: string,
  signal: AbortSignal | undefined,
): Promise<MonacoTypescriptCompilerOverrides | undefined> {
  const candidates = ['tsconfig.app.json', 'tsconfig.json']
  for (const name of candidates) {
    if (signal?.aborted) return undefined
    const raw = await tryReadText(joinWorkspace(workspaceFolder, name))
    if (!raw) continue
    const parsed = parseJsonc<TsconfigShape>(raw)
    if (!parsed) continue

    let options = parsed.compilerOptions
    // 一层 extends：根配置无 compilerOptions 时，合并被引用文件
    if (!options && typeof parsed.extends === 'string' && parsed.extends.trim()) {
      if (signal?.aborted) return undefined
      const extendsPath = joinWorkspace(
        workspaceFolder,
        ...parsed.extends.trim().replace(/^\.\//, '').split('/'),
      )
      const extendsRaw = await tryReadText(extendsPath)
      const extendsParsed = extendsRaw ? parseJsonc<TsconfigShape>(extendsRaw) : undefined
      options = extendsParsed?.compilerOptions
    }
    if (!options) continue

    return compilerOptionsFromTsconfig(workspaceFolder, options)
  }
  return {
    baseUrl: monacoFileUriString(workspaceFolder),
    moduleResolution: MonacoModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  }
}

function extractRelativeImportSpecs(source: string): string[] {
  const specs = new Set<string>()
  RELATIVE_IMPORT_RE.lastIndex = 0
  let match: RegExpExecArray | undefined
  while ((match = RELATIVE_IMPORT_RE.exec(source) ?? undefined)) {
    const spec = match[1]
    if (spec) specs.add(spec)
  }
  return [...specs]
}

function resolveRelativeBase(fromFilePath: string, spec: string): string {
  const fromDir = parentDirFromPath(fromFilePath)
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

async function resolveRelativeModulePath(
  fromFilePath: string,
  spec: string,
): Promise<string | undefined> {
  const base = resolveRelativeBase(fromFilePath, spec)
  for (const suffix of RELATIVE_SPEC_EXTENSIONS) {
    if (!suffix && /\.[cm]?[jt]sx?$/.test(base)) {
      const exact = await filesStat(base)
      if (exact?.kind === 'file') return base
      continue
    }
    if (!suffix) continue
    const candidate = `${base}${suffix}`
    const stat = await filesStat(candidate)
    if (stat?.kind === 'file') return candidate
  }
  return undefined
}

/**
 * 将当前文件相对路径 import 指向的本地源文件挂成 Monaco model，
 * 使 TS 语言服务能解析 `./agents` 这类模块。
 * 不在中途 abort：完整跑完 BFS，由编排层用 generation 丢弃过期结果。
 * @returns 是否新挂载了本地依赖 model（调用方据此决定是否强制重跑语义诊断）
 */
export async function syncVscodeTypescriptLocalModules(
  entryPath: string,
  entryText: string,
): Promise<boolean> {
  ensureMonacoEnvironment()

  const language = monacoLanguageFromFileName(fileNameFromAbsolutePath(entryPath))
  if (language !== 'typescript' && language !== 'javascript') return false

  ensureMonacoPathModel(entryPath, entryText, language)

  const queue: { path: string; text: string; depth: number }[] = [
    { path: entryPath, text: entryText, depth: 0 },
  ]
  const visited = new Set<string>([entryPath])
  let addedLocalModules = false

  while (queue.length > 0) {
    if (localModuleModelPaths.size >= MAX_LOCAL_MODULE_FILES) return addedLocalModules

    const current = queue.shift()
    if (!current || current.depth >= MAX_LOCAL_MODULE_DEPTH) continue

    for (const spec of extractRelativeImportSpecs(current.text)) {
      if (localModuleModelPaths.size >= MAX_LOCAL_MODULE_FILES) return addedLocalModules

      const resolved = await resolveRelativeModulePath(current.path, spec)
      if (!resolved || visited.has(resolved)) continue
      visited.add(resolved)

      const text = await tryReadText(resolved)
      if (text === undefined) continue

      const resolvedLanguage = monacoLanguageFromFileName(fileNameFromAbsolutePath(resolved))
      ensureMonacoPathModel(resolved, text, resolvedLanguage)
      if (!localModuleModelPaths.has(resolved)) {
        localModuleModelPaths.add(resolved)
        addedLocalModules = true
      }

      if (resolvedLanguage === 'typescript' || resolvedLanguage === 'javascript') {
        queue.push({ path: resolved, text, depth: current.depth + 1 })
      }
    }
  }

  return addedLocalModules
}

export function clearVscodeTypescriptLocalModules(preservePaths?: ReadonlySet<string>): void {
  for (const path of [...localModuleModelPaths]) {
    if (preservePaths?.has(path)) continue
    disposeMonacoModelForPath(path)
    localModuleModelPaths.delete(path)
  }
}

/**
 * 将工作区 package.json 依赖的类型声明注入 Monaco。
 * 失败时静默降级；可用 AbortSignal 取消切换中的旧任务。
 */
export async function syncVscodeTypescriptWorkspace(
  workspaceFolder: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  ensureMonacoEnvironment()

  if (!workspaceFolder) {
    clearMonacoTypescriptExtraLibs()
    applyMonacoTypescriptCompilerOverrides(undefined)
    clearVscodeTypescriptLocalModules()
    return
  }

  const root = workspaceFolder.replace(/\/+$/, '') || '/'
  const packageRaw = await tryReadText(joinWorkspace(root, 'package.json'))
  if (signal?.aborted) return

  if (!packageRaw) {
    clearMonacoTypescriptExtraLibs()
    applyMonacoTypescriptCompilerOverrides({
      baseUrl: monacoFileUriString(root),
      moduleResolution: MonacoModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    })
    return
  }

  const packageJson = parseJsonc<PackageJsonShape>(packageRaw)
  if (!packageJson) {
    clearMonacoTypescriptExtraLibs()
    applyMonacoTypescriptCompilerOverrides({
      baseUrl: monacoFileUriString(root),
      moduleResolution: MonacoModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    })
    return
  }

  const overrides = await loadTsconfigOverrides(root, signal)
  if (signal?.aborted) return
  applyMonacoTypescriptCompilerOverrides(overrides)

  const libMap = new Map<string, string>()
  const deps = collectDependencyNames(packageJson)

  for (const name of deps) {
    if (signal?.aborted || libMap.size >= MAX_TOTAL_LIBS) break
    const packageRoot = joinWorkspace(root, 'node_modules', ...packageDirSegments(name))
    const exists = await filesStat(packageRoot)
    if (!exists || exists.kind !== 'folder') continue
    await collectDtsInPackage(packageRoot, libMap, signal)
  }

  if (signal?.aborted) return

  const libs = [...libMap.entries()].map(([path, content]) => ({
    content,
    filePath: monacoFileUriString(path),
  }))
  setMonacoTypescriptExtraLibs(libs)
}

/** 上一轮编排 sync 的 Promise；新请求先等它结束，避免并发改 worker */
let typescriptSyncInFlight: Promise<void> | undefined
/** 已成功完成 workspace sync 的文件夹（避免每次按键重扫 node_modules） */
let lastSyncedWorkspaceFolder: string | undefined | null = null

/**
 * 先同步工作区类型 / compilerOptions，再对全部打开的 TS/JS 入口做本地模块 BFS。
 * 文本编辑用 generation 丢弃过期编排；硬取消（卸载 / 切换工作区）用 AbortSignal 打断 workspace sync。
 */
export async function syncVscodeTypescriptAll(options: {
  workspaceFolder: string | undefined
  entries: readonly VscodeTypescriptSyncEntry[]
  signal?: AbortSignal
}): Promise<void> {
  const generation = ++typescriptSyncGeneration
  const { workspaceFolder, entries, signal } = options
  const previous = typescriptSyncInFlight

  const run = (async () => {
    if (previous) await previous.catch(() => undefined)
    if (signal?.aborted || generation !== typescriptSyncGeneration) return

    if (workspaceFolder !== lastSyncedWorkspaceFolder) {
      await syncVscodeTypescriptWorkspace(workspaceFolder, signal)
      if (signal?.aborted || generation !== typescriptSyncGeneration) return
      lastSyncedWorkspaceFolder = workspaceFolder
    }

    let localModulesAdded = false
    for (const entry of entries) {
      if (signal?.aborted || generation !== typescriptSyncGeneration) return
      const added = await syncVscodeTypescriptLocalModules(entry.path, entry.text)
      if (added) localModulesAdded = true
    }

    // 新挂本地依赖后才强制重跑；否则会清掉 markers 造成切标签闪烁
    if (!signal?.aborted && generation === typescriptSyncGeneration && localModulesAdded) {
      refreshMonacoTypescriptSemantics()
    }
  })()

  typescriptSyncInFlight = run
  try {
    await run
  } finally {
    if (typescriptSyncInFlight === run) {
      typescriptSyncInFlight = undefined
    }
  }
}
