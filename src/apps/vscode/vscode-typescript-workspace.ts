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
import { extractImportSpecs, type ResolvedModuleFiles } from './vscode-typescript-module-resolve.ts'
import {
  clearBareModulesResolveState,
  resolveBareModulesForEntries,
} from './vscode-typescript-resolve-client.ts'
import { appendVscodeInternalLog } from './vscode-internal-log.ts'

const MAX_LOCAL_MODULE_FILES = 80
const MAX_LOCAL_MODULE_DEPTH = 8
const MAX_PACKAGE_FILES_TOTAL = 500
/** 普通包；@types/node 在 core 内单独提到 MAX_TYPES_NODE_FILES */
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

/** 上一轮成功注入的 extraLibs 路径集合（失败时不清空） */
let lastInjectedExtraLibPaths = new Set<string>()

/** 编排 sync 代数：文本编辑时用它丢弃过期结果，而非中途 abort BFS */
let typescriptSyncGeneration = 0

export type VscodeTypescriptSyncEntry = {
  path: string
  text: string
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
 * 重负载在 Worker 中完成；主线程只做 model / extraLibs 注入。
 * @returns success 表示至少注入了文件，可供 bareKey 缓存
 */
async function syncBareModulesForEntries(
  entries: readonly VscodeTypescriptSyncEntry[],
  workspaceFolder: string | undefined,
  signal?: AbortSignal,
  clearMissing = false,
): Promise<{ files: ResolvedModuleFiles; addedModels: boolean; success: boolean }> {
  if (!workspaceFolder) {
    return { files: new Map(), addedModels: false, success: false }
  }

  const root = workspaceFolder.replace(/\/+$/, '') || '/'
  const result = await resolveBareModulesForEntries({
    workspaceFolder: root,
    entries,
    maxPackageFilesTotal: MAX_PACKAGE_FILES_TOTAL,
    maxPackageFilesPerResolve: MAX_PACKAGE_FILES_PER_RESOLVE,
    clearMissing,
    signal,
  })

  if (signal?.aborted) {
    return { files: new Map(), addedModels: false, success: false }
  }

  const overrides: MonacoTypescriptCompilerOverrides = {
    baseUrl: monacoFileUriString(result.monacoOverrides?.baseUrlPath ?? root),
    moduleResolution: MonacoModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    ...(result.monacoOverrides?.paths ? { paths: result.monacoOverrides.paths } : undefined),
  }
  applyMonacoTypescriptCompilerOverrides(overrides)

  const collected: ResolvedModuleFiles = new Map(
    result.files.map((file) => [file.path, file.content]),
  )

  if (collected.size > 0) {
    const addedModels = injectResolvedFiles(collected)
    const libs = [...collected.entries()].map(([path, content]) => ({
      content,
      filePath: monacoFileUriString(path),
    }))
    setMonacoTypescriptExtraLibs(libs)
    lastInjectedExtraLibPaths = new Set(collected.keys())
    clearPackageModuleModels(lastInjectedExtraLibPaths)
    appendVscodeInternalLog(
      'ts-inject',
      `已注入 Monaco extraLibs=${libs.length} paths=${Object.keys(result.monacoOverrides?.paths ?? {}).length}`,
    )
    return { files: collected, addedModels, success: true }
  }

  // 全失败时保留上一轮有效 extraLibs，避免闪 2307
  appendVscodeInternalLog('ts-inject', '解析结果为空，保留上一轮 extraLibs', 'warn')
  return { files: collected, addedModels: false, success: false }
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
    lastInjectedExtraLibPaths = new Set()
    clearBareModulesResolveState()
    return ''
  }

  const root = workspaceFolder.replace(/\/+$/, '') || '/'
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

/** 上一轮活跃 sync 的 Promise；新请求先等它结束，避免并发改 worker */
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
      await syncVscodeTypescriptWorkspace(workspaceFolder, signal)
      if (signal?.aborted || generation !== typescriptSyncGeneration) return

      const bareResult = await syncBareModulesForEntries(entries, workspaceFolder, signal, true)
      if (signal?.aborted || generation !== typescriptSyncGeneration) return
      // 仅成功注入时锁定 bareKey，避免空结果永久不重试
      if (bareResult.success) {
        lastSyncedBareKey = bareKey
        bareSynced = true
      }
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
