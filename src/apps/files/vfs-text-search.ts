/**
 * VFS 文本搜索（grep 等价能力）。
 * 供 instant.grep、VS Code 工作区搜索等复用。
 */
import { filesList, filesReadText, filesStat } from './files-api.ts'
import { isBinaryContent } from './is-binary-file.ts'
import {
  compileSearchGlobs,
  DEFAULT_SEARCH_EXCLUDE_GLOBS,
  parseSearchGlobList,
  pathPassesIncludeExclude,
} from '../vscode/vscode-workspace-search-glob.ts'
import {
  isIgnoredBySets,
  relativeToWorkspace,
  tryLoadGitIgnoreSet,
  type GitIgnoreSet,
} from '../vscode/vscode-workspace-search-ignore.ts'
import {
  buildSearchRegExp,
  findMatchesInLine,
  type VscodeSearchMatchOptions,
} from '../vscode/vscode-workspace-search-match.ts'

const MAX_WALK_DEPTH = 8
const MAX_FILES = 400
const MAX_FILE_BYTES = 512 * 1024
const DEFAULT_MAX_MATCHES = 40
const PREVIEW_MAX = 120
/** 每处理这么多文件就向调用方推一次结果，并让出事件循环 */
const REPORT_EVERY_FILES = 8

/** 始终跳过：版本库元数据（通常不写进 .gitignore） */
const ALWAYS_SKIP_DIR_NAMES = new Set(['.git'])

export type VfsTextSearchContextLine = {
  line: number
  text: string
  /** 是否为命中行 */
  isMatch: boolean
}

export type VfsTextSearchMatch = {
  path: string
  name: string
  line: number
  /** 1-based 匹配起始列 */
  column: number
  matchLength: number
  /** 整行预览（可含截断） */
  preview: string
  matchedText: string
  /** 可选上下文 */
  context?: VfsTextSearchContextLine[]
}

export type VfsTextSearchResult = {
  matches: VfsTextSearchMatch[]
  truncated: boolean
  scannedFiles: number
  patternError?: string
}

export type VfsTextSearchParams = VscodeSearchMatchOptions & {
  query: string
  /** 搜索根（目录或单文件）；调用方负责解析为绝对路径 */
  rootPath: string
  /** 已打开路径等，扫描时跳过 */
  skipPaths?: ReadonlySet<string> | string[]
  signal?: AbortSignal
  /** 扫描过程中增量推送当前已积累的命中 */
  onProgress?: (matches: VfsTextSearchMatch[]) => void
  filesToInclude?: string
  filesToExclude?: string
  /** 默认 true：遵守 gitignore + 默认 search.exclude */
  useExcludeSettingsAndIgnoreFiles?: boolean
  /** 仅搜这些路径；空 Set 则视为无命中 */
  onlyPaths?: ReadonlySet<string> | string[]
  /** 命中上限，默认 40 */
  maxMatches?: number
  /** 命中上下文字行数（前后各 N 行） */
  contextLines?: number
}

function fileNameFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function toPathSet(paths: ReadonlySet<string> | string[] | undefined): ReadonlySet<string> | undefined {
  if (!paths) return undefined
  return paths instanceof Set ? paths : new Set(paths)
}

function buildContext(
  lines: string[],
  lineIndex: number,
  contextLines: number,
): VfsTextSearchContextLine[] | undefined {
  if (contextLines <= 0) return undefined
  const start = Math.max(0, lineIndex - contextLines)
  const end = Math.min(lines.length - 1, lineIndex + contextLines)
  const result: VfsTextSearchContextLine[] = []
  for (let i = start; i <= end; i += 1) {
    result.push({
      line: i + 1,
      text: lines[i] ?? '',
      isMatch: i === lineIndex,
    })
  }
  return result
}

function matchLinesInText(
  text: string,
  pattern: RegExp,
  base: { path: string; name: string },
  matches: VfsTextSearchMatch[],
  hitLimit: number,
  contextLines: number,
): void {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (matches.length >= hitLimit) return
    const line = lines[index]!
    const lineMatches = findMatchesInLine(line, pattern)
    for (const match of lineMatches) {
      if (matches.length >= hitLimit) return
      const trimmedPreview = line.trim()
      matches.push({
        path: base.path,
        name: base.name,
        line: index + 1,
        column: match.column,
        matchLength: match.matchLength,
        preview: trimmedPreview.slice(0, PREVIEW_MAX),
        matchedText: match.matchedText,
        context: buildContext(lines, index, contextLines),
      })
    }
  }
}

async function collectFiles(
  rootPath: string,
  skipPaths: ReadonlySet<string>,
  signal: AbortSignal | undefined,
  options: {
    useIgnore: boolean
    includeGlobs: readonly RegExp[]
    excludeGlobs: readonly RegExp[]
    onlyPaths: ReadonlySet<string> | undefined
  },
): Promise<Array<{ path: string; name: string }>> {
  const root = rootPath.replace(/\/+$/, '') || '/'
  const files: Array<{ path: string; name: string }> = []

  async function walk(
    dirPath: string,
    depth: number,
    ignoreStack: GitIgnoreSet[],
  ): Promise<void> {
    if (signal?.aborted) return
    if (depth > MAX_WALK_DEPTH || files.length >= MAX_FILES) return

    const dirRel = relativeToWorkspace(root, dirPath)
    let nextStack = ignoreStack
    if (options.useIgnore) {
      const localIgnore = await tryLoadGitIgnoreSet(dirPath, dirRel, filesReadText)
      nextStack = localIgnore ? [...ignoreStack, localIgnore] : ignoreStack
    }

    let entries
    try {
      entries = await filesList(dirPath)
    } catch {
      return
    }

    for (const entry of entries) {
      if (signal?.aborted || files.length >= MAX_FILES) return

      const entryRel = relativeToWorkspace(root, entry.path)

      if (entry.kind === 'folder') {
        if (ALWAYS_SKIP_DIR_NAMES.has(entry.name)) continue
        if (options.useIgnore && isIgnoredBySets(nextStack, entryRel, true)) continue
        await walk(entry.path, depth + 1, nextStack)
        continue
      }

      if (skipPaths.has(entry.path)) continue
      if (options.onlyPaths && !options.onlyPaths.has(entry.path)) continue
      if (options.useIgnore && isIgnoredBySets(nextStack, entryRel, false)) continue
      if (!pathPassesIncludeExclude(entryRel, options.includeGlobs, options.excludeGlobs)) continue
      if (entry.byteSize > MAX_FILE_BYTES) continue

      files.push({ path: entry.path, name: entry.name })
    }
  }

  await walk(root, 0, [])
  return files
}

/**
 * 在 VFS 指定根路径下搜索文本（目录递归；单文件只搜该文件）。
 */
export async function searchVfsText(params: VfsTextSearchParams): Promise<VfsTextSearchResult> {
  const query = params.query.trim()
  if (!query) {
    return { matches: [], truncated: false, scannedFiles: 0 }
  }

  const rootPath = params.rootPath.trim()
  if (!rootPath) {
    return { matches: [], truncated: false, scannedFiles: 0 }
  }

  const pattern = buildSearchRegExp(query, params)
  if (!pattern) {
    return {
      matches: [],
      truncated: false,
      scannedFiles: 0,
      patternError: '无效的正则表达式',
    }
  }

  const skipPaths = toPathSet(params.skipPaths) ?? new Set<string>()
  const onlyPaths = toPathSet(params.onlyPaths)
  if (onlyPaths && onlyPaths.size === 0) {
    return { matches: [], truncated: false, scannedFiles: 0 }
  }

  const maxMatches = params.maxMatches ?? DEFAULT_MAX_MATCHES
  const useExclude = params.useExcludeSettingsAndIgnoreFiles !== false
  const includeGlobs = compileSearchGlobs(parseSearchGlobList(params.filesToInclude))
  const excludeUser = parseSearchGlobList(params.filesToExclude)
  const excludeGlobs = compileSearchGlobs([
    ...excludeUser,
    ...(useExclude ? DEFAULT_SEARCH_EXCLUDE_GLOBS : []),
  ])
  const contextLines = params.contextLines ?? 0

  const root = rootPath.replace(/\/+$/, '') || '/'
  const rootEntry = await filesStat(root)
  if (!rootEntry) {
    return { matches: [], truncated: false, scannedFiles: 0 }
  }

  let filesToScan: Array<{ path: string; name: string }>
  if (rootEntry.kind === 'file' || rootEntry.kind === 'symlink') {
    if (skipPaths.has(root)) {
      return { matches: [], truncated: false, scannedFiles: 0 }
    }
    if (onlyPaths && !onlyPaths.has(root)) {
      return { matches: [], truncated: false, scannedFiles: 0 }
    }
    if (rootEntry.byteSize > MAX_FILE_BYTES) {
      return { matches: [], truncated: false, scannedFiles: 0 }
    }
    const rel = relativeToWorkspace(root, root)
    if (!pathPassesIncludeExclude(rel, includeGlobs, excludeGlobs)) {
      return { matches: [], truncated: false, scannedFiles: 0 }
    }
    filesToScan = [{ path: root, name: rootEntry.name || fileNameFromPath(root) }]
  } else {
    filesToScan = await collectFiles(root, skipPaths, params.signal, {
      useIgnore: useExclude,
      includeGlobs,
      excludeGlobs,
      onlyPaths,
    })
  }

  const matches: VfsTextSearchMatch[] = []
  let scannedFiles = 0
  let truncated = false

  for (const file of filesToScan) {
    if (params.signal?.aborted) break
    if (matches.length >= maxMatches) {
      truncated = true
      break
    }

    let text: string
    try {
      text = await filesReadText(file.path)
    } catch {
      scannedFiles += 1
      continue
    }

    if (text.length > MAX_FILE_BYTES || isBinaryContent(text)) {
      scannedFiles += 1
      continue
    }

    const before = matches.length
    matchLinesInText(
      text,
      pattern,
      {
        path: file.path,
        name: file.name || fileNameFromPath(file.path),
      },
      matches,
      maxMatches,
      contextLines,
    )
    scannedFiles += 1

    if (matches.length >= maxMatches && matches.length > before) {
      truncated = true
    }

    if (matches.length > before || scannedFiles % REPORT_EVERY_FILES === 0) {
      params.onProgress?.(matches.slice())
      await yieldEventLoop()
      if (params.signal?.aborted) break
    }
  }

  if (!truncated && filesToScan.length >= MAX_FILES && matches.length >= maxMatches) {
    truncated = true
  }

  return {
    matches,
    truncated,
    scannedFiles,
    patternError: undefined,
  }
}
