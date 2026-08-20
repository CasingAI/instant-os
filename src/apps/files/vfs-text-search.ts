/**
 * VFS 文本搜索（grep 等价能力）。
 * 供 instant.grep、VS Code 工作区搜索等复用。
 */
import {
  filesList,
  filesListSubtreeFiles,
  filesReadText,
  filesReadTextIfSmall,
  filesStat,
} from './files-api.ts'
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

const MAX_WALK_DEPTH = 64
const MAX_FILES = 10000
const MAX_FILE_BYTES = 512 * 1024
const DEFAULT_MAX_MATCHES = 100
const PREVIEW_MAX = 120
/** 并发读取文件的窗口大小（有界并发，避免内存与 FSA 争抢）；每窗向调用方推一次结果并让出事件循环 */
const SCAN_READ_CONCURRENCY = 8

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
  /** 结果可能不完整（命中/文件数/深度/超时任一上限触发） */
  truncated: boolean
  /** 截断原因 */
  truncatedReason?: 'maxMatches' | 'maxFiles' | 'maxDepth' | 'timeout'
  scannedFiles: number
  /** 本次收集到的文件总数（用于判断 maxFiles 是否被触达） */
  filesToScan: number
  /** 目录下文件总数（仅 includeTotalCount 时；仅本地卷原生可计数，挂载卷为 undefined） */
  totalFiles?: number
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
  /** 命中上限，默认 100 */
  maxMatches?: number
  /** 最多扫描文件数，默认 10000；0 表示不限制（配合 timeoutMs 做纯时间兜底） */
  maxFiles?: number
  /** 目录递归最大深度，默认 64 */
  maxDepth?: number
  /** 单文件大小上限（超出跳过），默认 512 * 1024 */
  maxFileBytes?: number
  /** 是否返回目录文件总数（仅本地卷原生可计数，挂载卷返回 undefined） */
  includeTotalCount?: boolean
  /** 软截止（毫秒），覆盖枚举+扫描；超时返回部分结果并标记 truncatedReason='timeout'。undefined 表示不限制 */
  timeoutMs?: number
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

/** 收集阶段因预算停止的原因 */
type CollectFilesCap = 'maxFiles' | 'maxDepth' | 'timeout'

function isPastDeadline(deadline: number | undefined): boolean {
  return deadline !== undefined && performance.now() >= deadline
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
    maxFiles: number
    maxDepth: number
    maxFileBytes: number
    deadline: number | undefined
  },
): Promise<{ files: Array<{ path: string; name: string }>; capped: CollectFilesCap | undefined }> {
  const root = rootPath.replace(/\/+$/, '') || '/'
  const files: Array<{ path: string; name: string }> = []
  let capped: CollectFilesCap | undefined

  async function walk(
    dirPath: string,
    depth: number,
    ignoreStack: GitIgnoreSet[],
  ): Promise<void> {
    if (signal?.aborted) return
    if (isPastDeadline(options.deadline)) {
      capped ??= 'timeout'
      return
    }
    if (files.length >= options.maxFiles) {
      capped ??= 'maxFiles'
      return
    }

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
      if (signal?.aborted) return
      if (isPastDeadline(options.deadline)) {
        capped ??= 'timeout'
        return
      }
      if (files.length >= options.maxFiles) {
        capped ??= 'maxFiles'
        return
      }

      const entryRel = relativeToWorkspace(root, entry.path)

      if (entry.kind === 'folder') {
        if (ALWAYS_SKIP_DIR_NAMES.has(entry.name)) continue
        // 隐藏目录（点开头）默认跳过，与 ripgrep 一致；useExcludeSettingsAndIgnoreFiles:false 时可扫
        if (options.useIgnore && entry.name.startsWith('.')) continue
        if (options.useIgnore && isIgnoredBySets(nextStack, entryRel, true)) continue
        if (depth >= options.maxDepth) {
          // 目录已达深度上限，其子孙不会被扫描
          capped ??= 'maxDepth'
          continue
        }
        await walk(entry.path, depth + 1, nextStack)
        continue
      }

      if (skipPaths.has(entry.path)) continue
      if (options.onlyPaths && !options.onlyPaths.has(entry.path)) continue
      // 隐藏文件（点开头）默认跳过，与 ripgrep 一致；useExcludeSettingsAndIgnoreFiles:false 时可扫
      if (options.useIgnore && entry.name.startsWith('.')) continue
      if (options.useIgnore && isIgnoredBySets(nextStack, entryRel, false)) continue
      if (!pathPassesIncludeExclude(entryRel, options.includeGlobs, options.excludeGlobs)) continue
      if (entry.byteSize > options.maxFileBytes) continue

      if (files.length >= options.maxFiles) {
        capped ??= 'maxFiles'
        return
      }
      files.push({ path: entry.path, name: entry.name })
    }
  }

  await walk(root, 0, [])
  return { files, capped }
}

/** 有界并发映射，结果按下标回填保持顺序；worker 内部需自行吞错 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return
        results[index] = await worker(items[index]!, index)
      }
    },
  )
  await Promise.all(runners)
  return results
}

type ScanFileResult =
  | { kind: 'ok'; text: string }
  | { kind: 'skip' }
  | { kind: 'error' }
  | { kind: 'tooLarge' }
  | { kind: 'binary' }

/**
 * 在 VFS 指定根路径下搜索文本（目录递归；单文件只搜该文件）。
 */
export async function searchVfsText(params: VfsTextSearchParams): Promise<VfsTextSearchResult> {
  const query = params.query.trim()
  if (!query) {
    return { matches: [], truncated: false, scannedFiles: 0, filesToScan: 0 }
  }

  const rootPath = params.rootPath.trim()
  if (!rootPath) {
    return { matches: [], truncated: false, scannedFiles: 0, filesToScan: 0 }
  }

  const pattern = buildSearchRegExp(query, params)
  if (!pattern) {
    return {
      matches: [],
      truncated: false,
      scannedFiles: 0,
      filesToScan: 0,
      patternError: '无效的正则表达式',
    }
  }

  const skipPaths = toPathSet(params.skipPaths) ?? new Set<string>()
  const onlyPaths = toPathSet(params.onlyPaths)
  if (onlyPaths && onlyPaths.size === 0) {
    return { matches: [], truncated: false, scannedFiles: 0, filesToScan: 0 }
  }

  const maxMatches = params.maxMatches ?? DEFAULT_MAX_MATCHES
  /** 0 表示不限制文件数（配合 timeoutMs 做纯时间兜底） */
  const maxFiles =
    params.maxFiles === 0
      ? Number.POSITIVE_INFINITY
      : (params.maxFiles ?? MAX_FILES)
  const maxDepth = params.maxDepth ?? MAX_WALK_DEPTH
  const maxFileBytes = params.maxFileBytes ?? MAX_FILE_BYTES
  const deadline =
    params.timeoutMs !== undefined && params.timeoutMs > 0
      ? performance.now() + params.timeoutMs
      : undefined
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
    return { matches: [], truncated: false, scannedFiles: 0, filesToScan: 0 }
  }

  let filesToScan: Array<{ path: string; name: string }>
  let capped: CollectFilesCap | undefined
  if (rootEntry.kind === 'file' || rootEntry.kind === 'symlink') {
    if (skipPaths.has(root)) {
      return { matches: [], truncated: false, scannedFiles: 0, filesToScan: 0 }
    }
    if (onlyPaths && !onlyPaths.has(root)) {
      return { matches: [], truncated: false, scannedFiles: 0, filesToScan: 0 }
    }
    if (rootEntry.byteSize > maxFileBytes) {
      return { matches: [], truncated: false, scannedFiles: 0, filesToScan: 0 }
    }
    const rel = relativeToWorkspace(root, root)
    if (!pathPassesIncludeExclude(rel, includeGlobs, excludeGlobs)) {
      return { matches: [], truncated: false, scannedFiles: 0, filesToScan: 0 }
    }
    filesToScan = [{ path: root, name: rootEntry.name || fileNameFromPath(root) }]
  } else {
    const collected = await collectFiles(root, skipPaths, params.signal, {
      useIgnore: useExclude,
      includeGlobs,
      excludeGlobs,
      onlyPaths,
      maxFiles,
      maxDepth,
      maxFileBytes,
      deadline,
    })
    filesToScan = collected.files
    capped = collected.capped
  }

  const matches: VfsTextSearchMatch[] = []
  let scannedFiles = 0
  let truncatedReason: 'maxMatches' | 'maxFiles' | 'maxDepth' | 'timeout' | undefined

  for (let start = 0; start < filesToScan.length; start += SCAN_READ_CONCURRENCY) {
    if (params.signal?.aborted) break
    if (isPastDeadline(deadline)) {
      truncatedReason ??= 'timeout'
      break
    }
    if (matches.length >= maxMatches) {
      truncatedReason ??= 'maxMatches'
      break
    }

    const window = filesToScan.slice(start, start + SCAN_READ_CONCURRENCY)
    const results = await mapWithConcurrency<
      { path: string; name: string },
      ScanFileResult
    >(window, SCAN_READ_CONCURRENCY, async (file) => {
      if (params.signal?.aborted) return { kind: 'skip' }
      let text: string | undefined
      try {
        text = await filesReadTextIfSmall(file.path, maxFileBytes)
      } catch {
        return { kind: 'error' }
      }
      if (text === undefined) return { kind: 'tooLarge' }
      if (isBinaryContent(text)) return { kind: 'binary' }
      return { kind: 'ok', text }
    })

    for (let i = 0; i < results.length; i += 1) {
      if (params.signal?.aborted) break
      if (matches.length >= maxMatches) {
        truncatedReason ??= 'maxMatches'
        break
      }
      const file = window[i]!
      const fileResult = results[i]!
      scannedFiles += 1
      if (fileResult.kind !== 'ok') continue

      const before = matches.length
      matchLinesInText(
        fileResult.text,
        pattern,
        {
          path: file.path,
          name: file.name || fileNameFromPath(file.path),
        },
        matches,
        maxMatches,
        contextLines,
      )
      if (matches.length >= maxMatches && matches.length > before) {
        truncatedReason ??= 'maxMatches'
      }
    }

    params.onProgress?.(matches.slice())
    await yieldEventLoop()
  }

  let totalFiles: number | undefined
  if (params.includeTotalCount === true) {
    // 仅本地卷（IndexedDB）原生可计数；挂载卷无原生计数，保持 undefined
    try {
      const subtree = await filesListSubtreeFiles(rootPath)
      totalFiles = subtree.length
    } catch {
      totalFiles = undefined
    }
  }

  if (truncatedReason === undefined && capped !== undefined) {
    truncatedReason = capped
  }

  return {
    matches,
    truncated: truncatedReason !== undefined,
    truncatedReason,
    scannedFiles,
    filesToScan: filesToScan.length,
    totalFiles,
    patternError: undefined,
  }
}
