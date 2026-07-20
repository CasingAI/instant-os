import { filesList, filesReadText } from '../files/files-api.ts'
import { isBinaryContent } from '../files/is-binary-file.ts'
import {
  compileSearchGlobs,
  DEFAULT_SEARCH_EXCLUDE_GLOBS,
  parseSearchGlobList,
  pathPassesIncludeExclude,
} from './vscode-workspace-search-glob.ts'
import {
  isIgnoredBySets,
  relativeToWorkspace,
  tryLoadGitIgnoreSet,
  type GitIgnoreSet,
} from './vscode-workspace-search-ignore.ts'
import {
  buildSearchRegExp,
  findMatchesInLine,
  type VscodeSearchMatchOptions,
} from './vscode-workspace-search-match.ts'

const MAX_WALK_DEPTH = 8
const MAX_FILES = 400
const MAX_FILE_BYTES = 512 * 1024
const MAX_HITS = 500
const PREVIEW_MAX = 120
/** 每处理这么多文件就向调用方推一次结果，并让出事件循环 */
const REPORT_EVERY_FILES = 8

/** 始终跳过：版本库元数据（通常不写进 .gitignore） */
const ALWAYS_SKIP_DIR_NAMES = new Set(['.git'])

export type VscodeWorkspaceSearchOpenFile = {
  tabId: string
  path: string
  name: string
  text: string
}

export type VscodeSearchContextLine = {
  line: number
  text: string
  /** 是否为命中行 */
  isMatch: boolean
}

export type VscodeWorkspaceSearchHit = {
  /** 已打开标签才有；工作区未打开文件为 undefined */
  tabId: string | undefined
  path: string
  name: string
  line: number
  /** 1-based 匹配起始列 */
  column: number
  matchLength: number
  /** 整行预览（可含截断） */
  preview: string
  matchedText: string
  fromOpenTab: boolean
  /** 可选上下文（Search Editor） */
  context?: VscodeSearchContextLine[]
}

export type VscodeWorkspaceSearchParams = VscodeSearchMatchOptions & {
  query: string
  /** 已打开路径，扫描时跳过（正文以内存为准） */
  skipPaths: ReadonlySet<string> | string[]
  workspaceFolder: string | undefined
  signal?: AbortSignal
  /** 扫描过程中增量推送当前已积累的工作区命中（不含已打开文件） */
  onProgress?: (hits: VscodeWorkspaceSearchHit[]) => void
  filesToInclude?: string
  filesToExclude?: string
  /** 默认 true：遵守 gitignore + 默认 search.exclude */
  useExcludeSettingsAndIgnoreFiles?: boolean
  /** 仅搜已打开文件（由调用方处理；core 扫描可跳过） */
  onlyOpenEditors?: boolean
  /** 仅搜这些路径（dirty / changed）；空则视为无命中 */
  onlyPaths?: ReadonlySet<string> | string[]
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
): VscodeSearchContextLine[] | undefined {
  if (contextLines <= 0) return undefined
  const start = Math.max(0, lineIndex - contextLines)
  const end = Math.min(lines.length - 1, lineIndex + contextLines)
  const result: VscodeSearchContextLine[] = []
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
  base: { tabId: string | undefined; path: string; name: string; fromOpenTab: boolean },
  hits: VscodeWorkspaceSearchHit[],
  hitLimit: number,
  contextLines: number,
): void {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (hits.length >= hitLimit) return
    const line = lines[index]!
    const lineMatches = findMatchesInLine(line, pattern)
    for (const match of lineMatches) {
      if (hits.length >= hitLimit) return
      const trimmedPreview = line.trim()
      hits.push({
        tabId: base.tabId,
        path: base.path,
        name: base.name,
        line: index + 1,
        column: match.column,
        matchLength: match.matchLength,
        preview: trimmedPreview.slice(0, PREVIEW_MAX),
        matchedText: match.matchedText,
        fromOpenTab: base.fromOpenTab,
        context: buildContext(lines, index, contextLines),
      })
    }
  }
}

export type VscodeOpenFilesMatchResult = {
  hits: VscodeWorkspaceSearchHit[]
  /** 非法正则时为错误文案 */
  patternError: string | undefined
}

/** 同步匹配已打开文件；结果始终应排在工作区命中之前 */
export function matchVscodeOpenFiles(
  query: string,
  openFiles: VscodeWorkspaceSearchOpenFile[],
  options: VscodeSearchMatchOptions & {
    filesToInclude?: string
    filesToExclude?: string
    useExcludeSettingsAndIgnoreFiles?: boolean
    onlyPaths?: ReadonlySet<string> | string[]
    workspaceFolder?: string
    contextLines?: number
    hitLimit?: number
  } = {},
): VscodeOpenFilesMatchResult {
  const pattern = buildSearchRegExp(query, options)
  if (!query.trim()) return { hits: [], patternError: undefined }
  if (!pattern) {
    return { hits: [], patternError: '无效的正则表达式' }
  }

  const includeGlobs = compileSearchGlobs(parseSearchGlobList(options.filesToInclude))
  const excludeUser = parseSearchGlobList(options.filesToExclude)
  const useExclude = options.useExcludeSettingsAndIgnoreFiles !== false
  const excludeGlobs = compileSearchGlobs([
    ...excludeUser,
    ...(useExclude ? DEFAULT_SEARCH_EXCLUDE_GLOBS : []),
  ])
  const onlyPaths = toPathSet(options.onlyPaths)
  const hitLimit = options.hitLimit ?? MAX_HITS
  const contextLines = options.contextLines ?? 0
  const root = options.workspaceFolder?.replace(/\/+$/, '') || undefined

  const hits: VscodeWorkspaceSearchHit[] = []
  for (const file of openFiles) {
    if (hits.length >= hitLimit) break
    if (onlyPaths && !onlyPaths.has(file.path)) continue
    if (root) {
      const rel = relativeToWorkspace(root, file.path)
      if (!pathPassesIncludeExclude(rel, includeGlobs, excludeGlobs)) continue
    }
    matchLinesInText(
      file.text,
      pattern,
      {
        tabId: file.tabId,
        path: file.path,
        name: file.name,
        fromOpenTab: true,
      },
      hits,
      hitLimit,
      contextLines,
    )
  }
  return { hits, patternError: undefined }
}

async function collectWorkspaceFiles(
  workspaceFolder: string,
  skipPaths: ReadonlySet<string>,
  signal: AbortSignal | undefined,
  options: {
    useIgnore: boolean
    includeGlobs: readonly RegExp[]
    excludeGlobs: readonly RegExp[]
    onlyPaths: ReadonlySet<string> | undefined
  },
): Promise<Array<{ path: string; name: string }>> {
  const root = workspaceFolder.replace(/\/+$/, '') || '/'
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
        if (!pathPassesIncludeExclude(entryRel, options.includeGlobs, options.excludeGlobs)) {
          // 目录可能仍含子路径匹配 include；仅在有 include 且目录本身明显不匹配前缀时跳过较难，
          // 保守：仍走进目录，由文件级过滤。
        }
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

export type VscodeWorkspaceSearchCoreResult = {
  hits: VscodeWorkspaceSearchHit[]
  patternError: string | undefined
}

/**
 * 在当前线程扫描工作区未打开文件（供 Worker 或主线程回退调用）。
 */
export async function searchVscodeWorkspaceFilesCore(
  params: VscodeWorkspaceSearchParams,
): Promise<VscodeWorkspaceSearchHit[]> {
  const result = await searchVscodeWorkspaceFilesCoreDetailed(params)
  return result.hits
}

export async function searchVscodeWorkspaceFilesCoreDetailed(
  params: VscodeWorkspaceSearchParams,
): Promise<VscodeWorkspaceSearchCoreResult> {
  if (!params.query.trim() || !params.workspaceFolder) {
    return { hits: [], patternError: undefined }
  }
  if (params.onlyOpenEditors) {
    return { hits: [], patternError: undefined }
  }

  const pattern = buildSearchRegExp(params.query, params)
  if (!pattern) {
    return { hits: [], patternError: '无效的正则表达式' }
  }

  const skipPaths = toPathSet(params.skipPaths) ?? new Set<string>()
  const onlyPaths = toPathSet(params.onlyPaths)
  if (onlyPaths && onlyPaths.size === 0) {
    return { hits: [], patternError: undefined }
  }

  const useExclude = params.useExcludeSettingsAndIgnoreFiles !== false
  const includeGlobs = compileSearchGlobs(parseSearchGlobList(params.filesToInclude))
  const excludeUser = parseSearchGlobList(params.filesToExclude)
  const excludeGlobs = compileSearchGlobs([
    ...excludeUser,
    ...(useExclude ? DEFAULT_SEARCH_EXCLUDE_GLOBS : []),
  ])
  const contextLines = params.contextLines ?? 0

  const hits: VscodeWorkspaceSearchHit[] = []
  const workspaceFiles = await collectWorkspaceFiles(
    params.workspaceFolder,
    skipPaths,
    params.signal,
    {
      useIgnore: useExclude,
      includeGlobs,
      excludeGlobs,
      onlyPaths,
    },
  )

  let processed = 0
  for (const file of workspaceFiles) {
    if (params.signal?.aborted || hits.length >= MAX_HITS) break

    let text: string
    try {
      text = await filesReadText(file.path)
    } catch {
      processed += 1
      continue
    }

    if (text.length > MAX_FILE_BYTES || isBinaryContent(text)) {
      processed += 1
      continue
    }

    const before = hits.length
    matchLinesInText(
      text,
      pattern,
      {
        tabId: undefined,
        path: file.path,
        name: file.name || fileNameFromPath(file.path),
        fromOpenTab: false,
      },
      hits,
      MAX_HITS,
      contextLines,
    )
    processed += 1

    if (hits.length > before || processed % REPORT_EVERY_FILES === 0) {
      params.onProgress?.(hits.slice())
      await yieldEventLoop()
      if (params.signal?.aborted) break
    }
  }

  return { hits, patternError: undefined }
}
