import { filesReadText, filesStat } from '../files/files-api.ts'
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
import {
  collectResolvedPackageFiles,
  extractImportSpecs,
  FilesResolutionCache,
  loadNearestTsconfig,
  resolveBareSpecifier,
  toTsCompilerOptions,
  type ResolvedModuleFiles,
} from './vscode-typescript-module-resolve.ts'

const MAX_LOCAL_MODULE_FILES = 80
const MAX_LOCAL_MODULE_DEPTH = 8
const MAX_PACKAGE_FILES_TOTAL = 500
const MAX_PACKAGE_FILES_PER_RESOLVE = 40

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

/** 工作区内为相对路径解析而加载的 Monaco model 路径 */
const localModuleModelPaths = new Set<string>()

/** 为裸包解析注入的 model 路径（与相对路径分开，便于清理） */
const packageModuleModelPaths = new Set<string>()

/** 编排 sync 代数：文本编辑时用它丢弃过期结果，而非中途 abort BFS */
let typescriptSyncGeneration = 0

/** 每个工作区复用的 files-api 解析缓存 */
let resolutionCache: FilesResolutionCache | undefined
let resolutionCacheWorkspace: string | undefined

export type VscodeTypescriptSyncEntry = {
  path: string
  text: string
}

function fileNameFromAbsolutePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function getResolutionCache(workspaceFolder: string | undefined): FilesResolutionCache {
  const key = workspaceFolder?.replace(/\/+$/, '') || ''
  if (!resolutionCache || resolutionCacheWorkspace !== key) {
    clearPackageModuleModels()
    resolutionCache = new FilesResolutionCache()
    resolutionCacheWorkspace = key
  }
  return resolutionCache
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

function monacoOverridesFromNearest(
  workspaceFolder: string,
  nearest: Awaited<ReturnType<typeof loadNearestTsconfig>>,
): MonacoTypescriptCompilerOverrides {
  const baseDir = nearest?.configDirectory ?? workspaceFolder
  const overrides: MonacoTypescriptCompilerOverrides = {
    baseUrl: monacoFileUriString(baseDir),
    // Monaco 无真实 FS：诊断阶段始终 Bundler，避免 node/node16 与注入文件不同步导致 2307 分裂
    moduleResolution: MonacoModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  }
  const options = nearest?.compilerOptions
  if (options?.paths && typeof options.paths === 'object') {
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

function injectResolvedFiles(files: ResolvedModuleFiles): boolean {
  let added = false
  for (const [path, content] of files) {
    const language = monacoLanguageFromFileName(fileNameFromAbsolutePath(path))
    // package.json 用 json；.d.ts / .ts 用 typescript
    const lang =
      path.endsWith('package.json') || path.endsWith('.json')
        ? 'json'
        : language === 'javascript'
          ? 'javascript'
          : 'typescript'
    ensureMonacoPathModel(path, content, lang)
    if (!packageModuleModelPaths.has(path) && !localModuleModelPaths.has(path)) {
      packageModuleModelPaths.add(path)
      added = true
    }
  }
  return added
}

/**
 * 将当前文件相对路径 import 指向的本地源文件挂成 Monaco model。
 * @returns 是否新挂载了本地依赖 model
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

    const { relative } = extractImportSpecs(current.text)
    for (const spec of relative) {
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

function clearPackageModuleModels(preservePaths?: ReadonlySet<string>): void {
  for (const path of [...packageModuleModelPaths]) {
    if (preservePaths?.has(path)) continue
    disposeMonacoModelForPath(path)
    packageModuleModelPaths.delete(path)
  }
}

/**
 * 对打开文件中的裸包 import 做 Node 式解析并注入 Monaco。
 * 同时写入 extraLibs（含 package.json），便于 worker 做 exports 解析。
 */
async function syncBareModulesForEntries(
  entries: readonly VscodeTypescriptSyncEntry[],
  workspaceFolder: string | undefined,
  signal?: AbortSignal,
): Promise<{ files: ResolvedModuleFiles; addedModels: boolean }> {
  const cache = getResolutionCache(workspaceFolder)
  const collected: ResolvedModuleFiles = new Map()
  const resolvedSpecs = new Set<string>()
  let addedModels = false

  // 用第一个可解析的 nearest tsconfig；无则退回工作区根
  let sharedOptions = toTsCompilerOptions(undefined, workspaceFolder?.replace(/\/+$/, '') || '/')
  let monacoOverridesApplied = false

  for (const entry of entries) {
    if (signal?.aborted || collected.size >= MAX_PACKAGE_FILES_TOTAL) break

    const language = monacoLanguageFromFileName(fileNameFromAbsolutePath(entry.path))
    if (language !== 'typescript' && language !== 'javascript') continue

    const nearest = await loadNearestTsconfig(entry.path, cache, signal)
    if (signal?.aborted) break

    const configDir =
      nearest?.configDirectory ?? workspaceFolder?.replace(/\/+$/, '') ?? parentDirFromPath(entry.path)
    sharedOptions = toTsCompilerOptions(nearest?.compilerOptions, configDir)

    if (!monacoOverridesApplied && workspaceFolder) {
      applyMonacoTypescriptCompilerOverrides(
        monacoOverridesFromNearest(workspaceFolder.replace(/\/+$/, '') || '/', nearest),
      )
      monacoOverridesApplied = true
    }

    const { bare } = extractImportSpecs(entry.text)
    for (const spec of bare) {
      if (signal?.aborted || collected.size >= MAX_PACKAGE_FILES_TOTAL) break
      const cacheKey = `${parentDirFromPath(entry.path)}\0${spec}`
      if (resolvedSpecs.has(cacheKey)) continue
      resolvedSpecs.add(cacheKey)

      const resolved = await resolveBareSpecifier(
        cache,
        entry.path,
        spec,
        sharedOptions,
        signal,
      )
      if (!resolved) continue

      const before = collected.size
      await collectResolvedPackageFiles(
        cache,
        resolved,
        collected,
        signal,
        Math.min(MAX_PACKAGE_FILES_PER_RESOLVE, MAX_PACKAGE_FILES_TOTAL - collected.size),
      )
      if (collected.size > before) {
        // 稍后统一 inject
      }
    }
  }

  if (!monacoOverridesApplied && workspaceFolder) {
    applyMonacoTypescriptCompilerOverrides({
      baseUrl: monacoFileUriString(workspaceFolder.replace(/\/+$/, '') || '/'),
      moduleResolution: MonacoModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    })
  }

  if (collected.size > 0) {
    addedModels = injectResolvedFiles(collected)
    const libs = [...collected.entries()].map(([path, content]) => ({
      content,
      filePath: monacoFileUriString(path),
    }))
    setMonacoTypescriptExtraLibs(libs)
  } else {
    setMonacoTypescriptExtraLibs([])
  }

  return { files: collected, addedModels }
}

/**
 * 工作区级清理 / 无文件夹时重置。
 * @returns sync cache key
 */
export async function syncVscodeTypescriptWorkspace(
  workspaceFolder: string | undefined,
  _signal?: AbortSignal,
): Promise<string> {
  ensureMonacoEnvironment()

  if (!workspaceFolder) {
    clearMonacoTypescriptExtraLibs()
    applyMonacoTypescriptCompilerOverrides(undefined)
    clearVscodeTypescriptLocalModules()
    clearPackageModuleModels()
    resolutionCache?.clear()
    resolutionCache = undefined
    resolutionCacheWorkspace = undefined
    return ''
  }

  const root = workspaceFolder.replace(/\/+$/, '') || '/'
  getResolutionCache(root)
  return root
}

function entriesSyncKey(
  workspaceFolder: string | undefined,
  entries: readonly VscodeTypescriptSyncEntry[],
  nodeModulesHint: string,
): string {
  const root = workspaceFolder?.replace(/\/+$/, '') || ''
  const parts = entries.map((entry) => {
    const { bare } = extractImportSpecs(entry.text)
    return `${entry.path}|${bare.slice().sort().join(',')}`
  })
  parts.sort()
  return `${root}#${nodeModulesHint}#${parts.join(';')}`
}

/** 从工作区根与打开文件目录探测 node_modules，供缓存失效 */
async function probeNodeModulesHint(
  workspaceFolder: string | undefined,
  entries: readonly VscodeTypescriptSyncEntry[],
  signal?: AbortSignal,
): Promise<string> {
  const dirs = new Set<string>()
  if (workspaceFolder) dirs.add(workspaceFolder.replace(/\/+$/, '') || '/')
  for (const entry of entries.slice(0, 8)) {
    let dir = parentDirFromPath(entry.path)
    for (let i = 0; i < 6; i += 1) {
      dirs.add(dir)
      const parent = parentDirFromPath(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  const flags: string[] = []
  for (const dir of [...dirs].sort()) {
    if (signal?.aborted) break
    const nmPath = dir === '/' ? '/node_modules' : `${dir}/node_modules`
    try {
      const stat = await filesStat(nmPath)
      flags.push(`${dir}:${stat?.kind === 'folder' ? '1' : '0'}`)
    } catch {
      flags.push(`${dir}:0`)
    }
  }
  return flags.join(',')
}

/** 上一轮编排 sync 的 Promise；新请求先等它结束，避免并发改 worker */
let typescriptSyncInFlight: Promise<void> | undefined
/** 已成功完成「裸包解析」的缓存键（工作区 + 打开文件的裸 import 集合） */
let lastSyncedBareKey: string | undefined

/**
 * 先按打开文件做 Node 式裸包解析并注入，再对相对路径做本地 BFS。
 * 文本编辑用 generation 丢弃过期编排；硬取消用 AbortSignal。
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

    if (!workspaceFolder) {
      await syncVscodeTypescriptWorkspace(undefined, signal)
      lastSyncedBareKey = undefined
      return
    }

    const nodeModulesHint = await probeNodeModulesHint(workspaceFolder, entries, signal)
    if (signal?.aborted || generation !== typescriptSyncGeneration) return

    const bareKey = entriesSyncKey(workspaceFolder, entries, nodeModulesHint)
    let bareSynced = false

    if (bareKey !== lastSyncedBareKey) {
      getResolutionCache(workspaceFolder).clearMissing()
      await syncVscodeTypescriptWorkspace(workspaceFolder, signal)
      if (signal?.aborted || generation !== typescriptSyncGeneration) return

      await syncBareModulesForEntries(entries, workspaceFolder, signal)
      if (signal?.aborted || generation !== typescriptSyncGeneration) return
      lastSyncedBareKey = bareKey
      bareSynced = true
    }

    let localModulesAdded = false
    for (const entry of entries) {
      if (signal?.aborted || generation !== typescriptSyncGeneration) return
      const added = await syncVscodeTypescriptLocalModules(entry.path, entry.text)
      if (added) localModulesAdded = true
    }

    if (
      !signal?.aborted &&
      generation === typescriptSyncGeneration &&
      (localModulesAdded || bareSynced)
    ) {
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
