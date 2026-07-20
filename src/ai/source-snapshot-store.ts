import { unzipSync } from 'fflate'

const SNAPSHOT_URL = '/source-snapshot.zip'
const TEXT_DECODER = new TextDecoder('utf-8')

export type SourceGrepMatch = {
  path: string
  line: number
  text: string
}

export type SourceGrepResult = {
  matches: SourceGrepMatch[]
  truncated: boolean
  scannedFiles: number
}

let filesByPath: Map<string, Uint8Array> | undefined
let loadPromise: Promise<Map<string, Uint8Array>> | undefined

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function pathDepth(path: string): number {
  if (!path) {
    return 0
  }
  return path.split('/').filter(Boolean).length
}

function decodeText(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes)
}

async function loadSnapshot(): Promise<Map<string, Uint8Array>> {
  const response = await fetch(SNAPSHOT_URL)
  if (!response.ok) {
    throw new Error(`无法加载源码快照（HTTP ${response.status}）`)
  }

  const buffer = new Uint8Array(await response.arrayBuffer())
  const unzipped = unzipSync(buffer)
  const map = new Map<string, Uint8Array>()

  for (const [rawPath, bytes] of Object.entries(unzipped)) {
    if (rawPath.endsWith('/')) {
      continue
    }
    const path = normalizePath(rawPath)
    map.set(path, bytes)
  }

  return map
}

export async function ensureSourceSnapshotLoaded(): Promise<Map<string, Uint8Array>> {
  if (filesByPath) {
    return filesByPath
  }
  if (!loadPromise) {
    loadPromise = loadSnapshot()
      .then((map) => {
        filesByPath = map
        return map
      })
      .catch((error) => {
        loadPromise = undefined
        throw error
      })
  }
  return loadPromise
}

export async function listSourcePaths(options?: {
  prefix?: string
  maxDepth?: number
}): Promise<string[]> {
  const files = await ensureSourceSnapshotLoaded()
  const prefix = options?.prefix ? normalizePath(options.prefix) : ''
  const maxDepth = options?.maxDepth

  const paths = [...files.keys()]
    .filter((path) => {
      if (prefix && path !== prefix && !path.startsWith(`${prefix}/`)) {
        return false
      }
      if (maxDepth !== undefined) {
        const relative = prefix ? path.slice(prefix.length).replace(/^\//, '') : path
        if (pathDepth(relative) > maxDepth) {
          return false
        }
      }
      return true
    })
    .sort((a, b) => a.localeCompare(b))

  return paths
}

export async function readSourceFile(path: string): Promise<string | undefined> {
  const bytes = await readSourceBytes(path)
  if (bytes === undefined) return undefined
  return decodeText(bytes)
}

export async function readSourceBytes(path: string): Promise<Uint8Array | undefined> {
  const files = await ensureSourceSnapshotLoaded()
  return files.get(normalizePath(path))
}

export async function grepSource(options: {
  pattern: string
  pathPrefix?: string
  caseInsensitive?: boolean
  maxMatches?: number
}): Promise<SourceGrepResult> {
  const files = await ensureSourceSnapshotLoaded()
  const prefix = options.pathPrefix ? normalizePath(options.pathPrefix) : ''
  const maxMatches = options.maxMatches ?? 40
  const flags = options.caseInsensitive === false ? 'g' : 'gi'

  let regex: RegExp
  try {
    regex = new RegExp(options.pattern, flags)
  } catch {
    throw new Error(`无效的正则表达式: ${options.pattern}`)
  }

  const matches: SourceGrepMatch[] = []
  let scannedFiles = 0
  let truncated = false

  for (const path of [...files.keys()].sort((a, b) => a.localeCompare(b))) {
    if (prefix && path !== prefix && !path.startsWith(`${prefix}/`)) {
      continue
    }
    scannedFiles += 1
    const bytes = files.get(path)
    if (bytes === undefined) {
      continue
    }

    const content = decodeText(bytes)
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      regex.lastIndex = 0
      if (!regex.test(line)) {
        continue
      }
      matches.push({
        path,
        line: index + 1,
        text: line.length > 240 ? `${line.slice(0, 240)}…` : line,
      })
      if (matches.length >= maxMatches) {
        truncated = true
        return { matches, truncated, scannedFiles }
      }
    }
  }

  return { matches, truncated, scannedFiles }
}

/** 测试或热更新时可清空缓存 */
export function resetSourceSnapshotCache(): void {
  filesByPath = undefined
  loadPromise = undefined
}
