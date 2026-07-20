/**
 * 裸包解析编排（主线程与 Worker 共用）。
 */
import { parentDirFromPath } from '../../monaco/monaco-language.ts'
import {
  collectNodeBuiltinDeclaration,
  collectResolvedPackageFiles,
  extractImportSpecs,
  FilesResolutionCache,
  isNodeBuiltinSpecifier,
  loadNearestTsconfig,
  MAX_TYPES_NODE_FILES,
  normalizeNodeBuiltinSpecifier,
  resolveBareSpecifier,
  toTsCompilerOptions,
  typesNodeBuiltinDtsRel,
  type ResolveCompilerOptionsInput,
  type ResolvedModuleFiles,
} from './vscode-typescript-module-resolve.ts'
import type {
  VscodeTypescriptResolveEntry,
  VscodeTypescriptResolveLog,
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

function relativeToBase(baseDir: string, absolutePath: string): string | undefined {
  const base = (baseDir.replace(/\/+$/, '') || '/').replace(/^\//, '')
  const abs = (absolutePath.replace(/\/+$/, '') || '/').replace(/^\//, '')
  if (!abs) return undefined
  if (!base) return abs

  const baseParts = base.split('/').filter(Boolean)
  const absParts = abs.split('/').filter(Boolean)
  let i = 0
  while (i < baseParts.length && i < absParts.length && baseParts[i] === absParts[i]) {
    i += 1
  }
  const up = baseParts.length - i
  const down = absParts.slice(i)
  if (up === 0 && down.length === 0) return '.'
  return [...Array.from({ length: up }, () => '..'), ...down].join('/')
}

/** 把 specifier 映射到声明文件，供 Monaco Bundler 兜底（exports ambient 不齐时） */
function mergeSpecifierPaths(
  overrides: VscodeTypescriptResolveMonacoOverrides,
  specifier: string,
  dtsAbsolutePath: string,
  logs: VscodeTypescriptResolveLog[],
): void {
  const rel = relativeToBase(overrides.baseUrlPath, dtsAbsolutePath)
  if (!rel) {
    logs.push({
      level: 'warn',
      message: `paths 跳过 ${specifier}：无法相对化到 baseUrl ${overrides.baseUrlPath}`,
    })
    return
  }
  const paths = { ...(overrides.paths ?? {}) }
  const keys = new Set<string>([specifier])
  const builtin = normalizeNodeBuiltinSpecifier(specifier)
  if (builtin) {
    keys.add(builtin)
    keys.add(`node:${builtin}`)
  }
  for (const key of keys) {
    paths[key] = [rel]
  }
  overrides.paths = paths
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

  const logs: VscodeTypescriptResolveLog[] = []
  logs.push({
    level: 'info',
    message: `开始解析 workspace=${root} entries=${entries.length} clearMissing=${clearMissing === true}`,
  })

  const collected: ResolvedModuleFiles = new Map()
  const resolvedSpecs = new Set<string>()
  let sharedOptions = toTsCompilerOptions(undefined, root)
  let monacoOverrides: VscodeTypescriptResolveMonacoOverrides | undefined
  let nearestInput: ResolveCompilerOptionsInput | undefined
  let configDirectory = root
  let resolvedCount = 0

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

    if (specs.length > 0) {
      logs.push({ level: 'info', message: `${entry.path} 裸导入: ${specs.join(', ')}` })
    }

    const ordered = [
      ...specs.filter((s) => isNodeBuiltinSpecifier(s)),
      ...specs.filter((s) => !isNodeBuiltinSpecifier(s)),
    ]

    for (const spec of ordered) {
      if (signal?.aborted || collected.size >= maxPackageFilesTotal) break

      if (isNodeBuiltinSpecifier(spec)) {
        const before = collected.size
        const dtsPath = await collectNodeBuiltinDeclaration(
          cache,
          entry.path,
          spec,
          collected,
          signal,
          Math.min(MAX_TYPES_NODE_FILES, maxPackageFilesTotal - collected.size),
        )
        if (dtsPath) {
          resolvedCount += 1
          mergeSpecifierPaths(monacoOverrides, spec, dtsPath, logs)
          logs.push({ level: 'info', message: `✓ ${spec} → ${dtsPath}` })
        } else if (collected.size > before) {
          resolvedCount += 1
          const builtin = normalizeNodeBuiltinSpecifier(spec)
          if (builtin) {
            for (const path of collected.keys()) {
              if (path.endsWith(`/${typesNodeBuiltinDtsRel(builtin)}`)) {
                mergeSpecifierPaths(monacoOverrides, spec, path, logs)
                break
              }
            }
          }
          logs.push({ level: 'warn', message: `✓ ${spec}（部分收集）` })
        } else {
          logs.push({ level: 'error', message: `✗ ${spec} 未找到 @types/node` })
        }
        continue
      }

      const resolved = await resolveBareSpecifier(
        cache,
        entry.path,
        spec,
        sharedOptions,
        signal,
      )
      if (!resolved) {
        logs.push({ level: 'error', message: `✗ ${spec} 解析失败` })
        continue
      }
      resolvedCount += 1
      mergeSpecifierPaths(monacoOverrides, spec, resolved, logs)
      logs.push({ level: 'info', message: `✓ ${spec} → ${resolved}` })

      const perResolveMax = resolved.includes('/node_modules/@types/node/')
        ? Math.min(MAX_TYPES_NODE_FILES, maxPackageFilesTotal - collected.size)
        : Math.min(maxPackageFilesPerResolve, maxPackageFilesTotal - collected.size)

      const before = collected.size
      await collectResolvedPackageFiles(
        cache,
        resolved,
        collected,
        signal,
        perResolveMax,
        sharedOptions,
        entry.path,
      )
      logs.push({
        level: 'info',
        message: `收集 ${spec}: +${collected.size - before} 文件（合计 ${collected.size}）`,
      })
    }
  }

  if (!monacoOverrides) {
    monacoOverrides = { baseUrlPath: root }
  }

  logs.push({
    level: resolvedCount > 0 ? 'info' : 'warn',
    message: `完成: resolved=${resolvedCount} files=${collected.size} paths=${Object.keys(monacoOverrides.paths ?? {}).length}`,
  })

  return {
    files: [...collected.entries()].map(([path, content]) => ({ path, content })),
    monacoOverrides,
    nearestCompilerOptions: nearestInput,
    configDirectory,
    resolvedCount,
    logs,
  }
}
