import { filesList, filesReadText, filesStat } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { disposeMonacoModelForPath, ensureMonacoPathModel } from '../../monaco/monaco-editor.tsx'
import { monacoLanguageFromFileName, parentDirFromPath } from '../../monaco/monaco-language.ts'
import { ensureMonacoEnvironment } from '../../monaco/monaco-setup.ts'
import {
  applyMonacoTypescriptCompilerOverrides,
  clearMonacoTypescriptExtraLibs,
  monacoFileUriString,
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

const RELATIVE_IMPORT_RE =
  /(?:from\s+|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g

/** 工作区内为相对路径解析而加载的 Monaco model 路径 */
const localModuleModelPaths = new Set<string>()

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
    const options = parsed?.compilerOptions
    if (!options) continue

    const overrides: MonacoTypescriptCompilerOverrides = {
      baseUrl: monacoFileUriString(workspaceFolder),
    }
    if (typeof options.jsxImportSource === 'string' && options.jsxImportSource.trim()) {
      overrides.jsxImportSource = options.jsxImportSource.trim()
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
  return {
    baseUrl: monacoFileUriString(workspaceFolder),
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
 */
export async function syncVscodeTypescriptLocalModules(
  entryPath: string,
  entryText: string,
  signal?: AbortSignal,
): Promise<void> {
  ensureMonacoEnvironment()

  const language = monacoLanguageFromFileName(fileNameFromAbsolutePath(entryPath))
  if (language !== 'typescript' && language !== 'javascript') return

  ensureMonacoPathModel(entryPath, entryText, language)

  const queue: { path: string; text: string; depth: number }[] = [
    { path: entryPath, text: entryText, depth: 0 },
  ]
  const visited = new Set<string>([entryPath])

  while (queue.length > 0) {
    if (signal?.aborted) return
    if (localModuleModelPaths.size >= MAX_LOCAL_MODULE_FILES) return

    const current = queue.shift()
    if (!current || current.depth >= MAX_LOCAL_MODULE_DEPTH) continue

    for (const spec of extractRelativeImportSpecs(current.text)) {
      if (signal?.aborted) return
      if (localModuleModelPaths.size >= MAX_LOCAL_MODULE_FILES) return

      const resolved = await resolveRelativeModulePath(current.path, spec)
      if (!resolved || visited.has(resolved)) continue
      visited.add(resolved)

      const text = await tryReadText(resolved)
      if (text === undefined) continue

      const resolvedLanguage = monacoLanguageFromFileName(fileNameFromAbsolutePath(resolved))
      ensureMonacoPathModel(resolved, text, resolvedLanguage)
      localModuleModelPaths.add(resolved)

      if (resolvedLanguage === 'typescript' || resolvedLanguage === 'javascript') {
        queue.push({ path: resolved, text, depth: current.depth + 1 })
      }
    }
  }
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
    })
    return
  }

  const packageJson = parseJsonc<PackageJsonShape>(packageRaw)
  if (!packageJson) {
    clearMonacoTypescriptExtraLibs()
    applyMonacoTypescriptCompilerOverrides({
      baseUrl: monacoFileUriString(root),
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
