/**
 * 裸包解析编排（主线程与 Worker 共用）。
 */
import { parentDirFromPath } from '../../monaco/monaco-language.ts'
import {
  collectResolvedPackageFiles,
  extractImportSpecs,
  FilesResolutionCache,
  isNodeBuiltinSpecifier,
  loadNearestTsconfig,
  resolveBareSpecifier,
  toTsCompilerOptions,
  type ResolveCompilerOptionsInput,
  type ResolvedModuleFiles,
} from './vscode-typescript-module-resolve.ts'
import type {
  VscodeTypescriptResolveEntry,
  VscodeTypescriptResolveMonacoOverrides,
  VscodeTypescriptResolveResult,
} from './vscode-typescript-resolve-protocol.ts'

const cachesByWorkspace = new Map<string, FilesResolutionCache>()

function getCache(workspaceFolder: string): FilesResolutionCache {
  const key = workspaceFolder.replace(/\/+$/, '') || '/'
  let cache = cachesByWorkspace.get(key)
  if (!cache) {
    cache = new FilesResolutionCache()
    cachesByWorkspace.set(key, cache)
  }
  return cache
}

export function clearTypescriptResolveCaches(): void {
  for (const cache of cachesByWorkspace.values()) cache.clear()
  cachesByWorkspace.clear()
}

function fileNameFromAbsolutePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function isTsOrJsPath(path: string): boolean {
  const name = fileNameFromAbsolutePath(path).toLowerCase()
  return (
    name.endsWith('.ts') ||
    name.endsWith('.tsx') ||
    name.endsWith('.mts') ||
    name.endsWith('.cts') ||
    name.endsWith('.js') ||
    name.endsWith('.jsx') ||
    name.endsWith('.mjs') ||
    name.endsWith('.cjs')
  )
}

function monacoOverridesFromNearest(
  workspaceFolder: string,
  nearest: Awaited<ReturnType<typeof loadNearestTsconfig>>,
): VscodeTypescriptResolveMonacoOverrides {
  const baseDir = nearest?.configDirectory ?? workspaceFolder
  const overrides: VscodeTypescriptResolveMonacoOverrides = {
    baseUrlPath: baseDir,
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

/**
 * 对打开文件中的裸包 import 做 Node 式解析，返回待注入文件列表。
 */
export async function resolveBareModulesForEntriesCore(options: {
  workspaceFolder: string
  entries: readonly VscodeTypescriptResolveEntry[]
  maxPackageFilesTotal: number
  maxPackageFilesPerResolve: number
  clearMissing?: boolean
  signal?: AbortSignal
}): Promise<VscodeTypescriptResolveResult> {
  const {
    workspaceFolder,
    entries,
    maxPackageFilesTotal,
    maxPackageFilesPerResolve,
    clearMissing,
    signal,
  } = options

  const root = workspaceFolder.replace(/\/+$/, '') || '/'
  const cache = getCache(root)
  if (clearMissing) cache.clearMissing()

  const collected: ResolvedModuleFiles = new Map()
  const resolvedSpecs = new Set<string>()
  let sharedOptions = toTsCompilerOptions(undefined, root)
  let monacoOverrides: VscodeTypescriptResolveMonacoOverrides | undefined
  let nearestInput: ResolveCompilerOptionsInput | undefined
  let configDirectory = root

  const entryList = entries.filter((entry) => isTsOrJsPath(entry.path))

  for (const entry of entryList) {
    if (signal?.aborted || collected.size >= maxPackageFilesTotal) break

    const nearest = await loadNearestTsconfig(entry.path, cache, signal)
    if (signal?.aborted) break

    const configDir = nearest?.configDirectory ?? root
    nearestInput = nearest?.compilerOptions
    sharedOptions = toTsCompilerOptions(nearestInput, configDir)
    configDirectory = configDir

    if (!monacoOverrides) {
      monacoOverrides = monacoOverridesFromNearest(root, nearest)
    }

    const { bare } = extractImportSpecs(entry.text)
    const specs = bare.filter((spec) => {
      const cacheKey = `${parentDirFromPath(entry.path)}\0${spec}`
      if (resolvedSpecs.has(cacheKey)) return false
      resolvedSpecs.add(cacheKey)
      return true
    })

    const ordered = [
      ...specs.filter((s) => isNodeBuiltinSpecifier(s)),
      ...specs.filter((s) => !isNodeBuiltinSpecifier(s)),
    ]

    // 串行解析各 bare spec（共享 cache）；I/O 并行由 flushPending 承担
    for (const spec of ordered) {
      if (signal?.aborted || collected.size >= maxPackageFilesTotal) break
      const resolved = await resolveBareSpecifier(
        cache,
        entry.path,
        spec,
        sharedOptions,
        signal,
      )
      if (!resolved) continue
      await collectResolvedPackageFiles(
        cache,
        resolved,
        collected,
        signal,
        Math.min(maxPackageFilesPerResolve, maxPackageFilesTotal - collected.size),
        sharedOptions,
        entry.path,
      )
    }
  }

  if (!monacoOverrides) {
    monacoOverrides = { baseUrlPath: root }
  }

  return {
    files: [...collected.entries()].map(([path, content]) => ({ path, content })),
    monacoOverrides,
    nearestCompilerOptions: nearestInput,
    configDirectory,
  }
}
