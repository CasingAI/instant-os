import { filesList, filesReadText } from '../files/files-api.ts'
import {
  isIgnoredBySets,
  relativeToWorkspace,
  tryLoadGitIgnoreSet,
  type GitIgnoreSet,
} from './vscode-workspace-search-ignore.ts'

const MAX_WALK_DEPTH = 8
const MAX_FILES = 400
const MAX_FILE_BYTES = 512 * 1024
const MAX_HITS = 500
const PREVIEW_MAX = 120
/** 与 git buffer_is_binary / 常见实现一致：检查文件头一段是否含 NUL */
const BINARY_PROBE_BYTES = 8000
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

export type VscodeWorkspaceSearchHit = {
  /** 已打开标签才有；工作区未打开文件为 undefined */
  tabId: string | undefined
  path: string
  name: string
  line: number
  preview: string
  fromOpenTab: boolean
}

export type VscodeWorkspaceSearchParams = {
  query: string
  /** 已打开路径，扫描时跳过（正文以内存为准） */
  skipPaths: ReadonlySet<string> | string[]
  workspaceFolder: string | undefined
  signal?: AbortSignal
  /** 扫描过程中增量推送当前已积累的工作区命中（不含已打开文件） */
  onProgress?: (hits: VscodeWorkspaceSearchHit[]) => void
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

function toSkipSet(skipPaths: ReadonlySet<string> | string[]): ReadonlySet<string> {
  return skipPaths instanceof Set ? skipPaths : new Set(skipPaths)
}

/**
 * 主流启发式（git / ripgrep / GNU grep）：内容里出现 NUL 即视为二进制。
 * 此处检查解码后字符串前 BINARY_PROBE_BYTES 个码元（与 git 看前 8000 字节同量级）。
 */
function isBinaryByNulHeuristic(text: string): boolean {
  const limit = Math.min(text.length, BINARY_PROBE_BYTES)
  for (let i = 0; i < limit; i += 1) {
    if (text.charCodeAt(i) === 0) return true
  }
  return false
}

function matchLinesInText(
  text: string,
  queryLower: string,
  base: { tabId: string | undefined; path: string; name: string; fromOpenTab: boolean },
  hits: VscodeWorkspaceSearchHit[],
  hitLimit: number,
): void {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (hits.length >= hitLimit) return
    const line = lines[index]!
    if (!line.toLowerCase().includes(queryLower)) continue
    hits.push({
      tabId: base.tabId,
      path: base.path,
      name: base.name,
      line: index + 1,
      preview: line.trim().slice(0, PREVIEW_MAX),
      fromOpenTab: base.fromOpenTab,
    })
  }
}

/** 同步匹配已打开文件；结果始终应排在工作区命中之前 */
export function matchVscodeOpenFiles(
  query: string,
  openFiles: VscodeWorkspaceSearchOpenFile[],
): VscodeWorkspaceSearchHit[] {
  const queryLower = query.trim().toLowerCase()
  if (!queryLower) return []

  const hits: VscodeWorkspaceSearchHit[] = []
  for (const file of openFiles) {
    if (hits.length >= MAX_HITS) break
    matchLinesInText(
      file.text,
      queryLower,
      {
        tabId: file.tabId,
        path: file.path,
        name: file.name,
        fromOpenTab: true,
      },
      hits,
      MAX_HITS,
    )
  }
  return hits
}

async function collectWorkspaceFiles(
  workspaceFolder: string,
  skipPaths: ReadonlySet<string>,
  signal: AbortSignal | undefined,
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
    const localIgnore = await tryLoadGitIgnoreSet(dirPath, dirRel, filesReadText)
    const nextStack = localIgnore ? [...ignoreStack, localIgnore] : ignoreStack

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
        if (isIgnoredBySets(nextStack, entryRel, true)) continue
        await walk(entry.path, depth + 1, nextStack)
        continue
      }

      if (skipPaths.has(entry.path)) continue
      if (isIgnoredBySets(nextStack, entryRel, false)) continue
      if (entry.byteSize > MAX_FILE_BYTES) continue

      files.push({ path: entry.path, name: entry.name })
    }
  }

  await walk(root, 0, [])
  return files
}

/**
 * 在当前线程扫描工作区未打开文件（供 Worker 或主线程回退调用）。
 * 尊重各层 .gitignore；仅额外跳过 .git；二进制用 NUL 启发式判定（同 git/ripgrep）。
 */
export async function searchVscodeWorkspaceFilesCore(
  params: VscodeWorkspaceSearchParams,
): Promise<VscodeWorkspaceSearchHit[]> {
  const queryLower = params.query.trim().toLowerCase()
  if (!queryLower || !params.workspaceFolder) return []

  const skipPaths = toSkipSet(params.skipPaths)
  const hits: VscodeWorkspaceSearchHit[] = []
  const workspaceFiles = await collectWorkspaceFiles(
    params.workspaceFolder,
    skipPaths,
    params.signal,
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

    if (text.length > MAX_FILE_BYTES || isBinaryByNulHeuristic(text)) {
      processed += 1
      continue
    }

    const before = hits.length
    matchLinesInText(
      text,
      queryLower,
      {
        tabId: undefined,
        path: file.path,
        name: file.name || fileNameFromPath(file.path),
        fromOpenTab: false,
      },
      hits,
      MAX_HITS,
    )
    processed += 1

    if (hits.length > before || processed % REPORT_EVERY_FILES === 0) {
      params.onProgress?.(hits.slice())
      await yieldEventLoop()
      if (params.signal?.aborted) break
    }
  }

  return hits
}
