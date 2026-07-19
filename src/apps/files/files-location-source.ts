import {
  ensureSourceSnapshotLoaded,
  readSourceFile,
} from '../../ai/source-snapshot-store.ts'
import { FILES_TEXT_MIME, type FilesNode } from './files-types.ts'

const LOCATION_ID = 'source' as const
const EPOCH = 0
const READONLY_ATTRIBUTES = { writable: false } as const

function dirId(path: string): string {
  return `source:d:${path}`
}

function fileId(path: string): string {
  return `source:f:${path}`
}

function parseDirPath(id: string): string | undefined {
  if (!id.startsWith('source:d:')) return undefined
  return id.slice('source:d:'.length)
}

function parseFilePath(id: string): string | undefined {
  if (!id.startsWith('source:f:')) return undefined
  return id.slice('source:f:'.length)
}

function parentDirPath(path: string): string | undefined {
  const slash = path.lastIndexOf('/')
  if (slash <= 0) return undefined
  return path.slice(0, slash)
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

function guessMime(path: string): string {
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.md')) return 'text/markdown'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  return FILES_TEXT_MIME
}

function makeDirNode(path: string): FilesNode {
  const parent = parentDirPath(path)
  return {
    id: dirId(path),
    locationId: LOCATION_ID,
    parentId: parent === undefined ? undefined : dirId(parent),
    name: baseName(path),
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    attributes: READONLY_ATTRIBUTES,
  }
}

function makeFileNode(path: string, byteSize = 0): FilesNode {
  const parent = parentDirPath(path)
  return {
    id: fileId(path),
    locationId: LOCATION_ID,
    parentId: parent === undefined ? undefined : dirId(parent),
    name: baseName(path),
    kind: 'file',
    mimeType: guessMime(path),
    byteSize,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    attributes: READONLY_ATTRIBUTES,
  }
}

export async function getSourceNode(id: string): Promise<FilesNode | undefined> {
  const dirPath = parseDirPath(id)
  if (dirPath !== undefined) {
    const files = await ensureSourceSnapshotLoaded()
    const prefix = `${dirPath}/`
    const exists = [...files.keys()].some((path) => path === dirPath || path.startsWith(prefix))
    return exists ? makeDirNode(dirPath) : undefined
  }

  const filePath = parseFilePath(id)
  if (filePath !== undefined) {
    const text = await readSourceFile(filePath)
    if (text === undefined) return undefined
    return makeFileNode(filePath, new TextEncoder().encode(text).length)
  }

  return undefined
}

export async function listSourceDirectory(folderId: string | undefined): Promise<FilesNode[]> {
  const files = await ensureSourceSnapshotLoaded()
  const prefix = folderId === undefined ? undefined : parseDirPath(folderId)
  if (folderId !== undefined && prefix === undefined) return []

  const dirs = new Set<string>()
  const filePaths: string[] = []

  for (const path of files.keys()) {
    if (prefix !== undefined) {
      if (path === prefix || !path.startsWith(`${prefix}/`)) continue
      const rest = path.slice(prefix.length + 1)
      const slash = rest.indexOf('/')
      if (slash === -1) {
        filePaths.push(path)
      } else {
        dirs.add(`${prefix}/${rest.slice(0, slash)}`)
      }
    } else {
      const slash = path.indexOf('/')
      if (slash === -1) {
        filePaths.push(path)
      } else {
        dirs.add(path.slice(0, slash))
      }
    }
  }

  const nodes: FilesNode[] = [
    ...[...dirs].sort((a, b) => a.localeCompare(b)).map((path) => makeDirNode(path)),
    ...filePaths
      .sort((a, b) => a.localeCompare(b))
      .map((path) => {
        const text = files.get(path) ?? ''
        return makeFileNode(path, new TextEncoder().encode(text).length)
      }),
  ]

  return nodes
}

export async function resolveSourcePath(folderId: string | undefined): Promise<FilesNode[]> {
  if (folderId === undefined) return []
  const dirPath = parseDirPath(folderId)
  if (dirPath === undefined) return []

  const chain: FilesNode[] = []
  let current: string | undefined = dirPath
  while (current !== undefined) {
    chain.unshift(makeDirNode(current))
    current = parentDirPath(current)
  }
  return chain
}

export async function readSourceText(id: string): Promise<{ node: FilesNode; text: string }> {
  const filePath = parseFilePath(id)
  if (filePath === undefined) {
    throw new Error('文件不存在')
  }
  const text = await readSourceFile(filePath)
  if (text === undefined) {
    throw new Error('文件不存在')
  }
  return {
    node: makeFileNode(filePath, new TextEncoder().encode(text).length),
    text,
  }
}
