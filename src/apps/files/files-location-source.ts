import {
  ensureSourceSnapshotLoaded,
  readSourceBytes,
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
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.css')) return 'text/css'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')) {
    return 'text/markdown'
  }
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.ico')) return 'image/x-icon'
  if (lower.endsWith('.gltf')) return 'model/gltf+json'
  if (lower.endsWith('.glb')) return 'model/gltf-binary'
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
    const bytes = await readSourceBytes(filePath)
    if (bytes === undefined) return undefined
    return makeFileNode(filePath, bytes.byteLength)
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
        const bytes = files.get(path)
        return makeFileNode(path, bytes?.byteLength ?? 0)
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
  const bytes = await readSourceBytes(filePath)
  return {
    node: makeFileNode(filePath, bytes?.byteLength ?? new TextEncoder().encode(text).length),
    text,
  }
}

export async function readSourceBlob(id: string): Promise<{ node: FilesNode; blob: Blob }> {
  const filePath = parseFilePath(id)
  if (filePath === undefined) {
    throw new Error('文件不存在')
  }
  const bytes = await readSourceBytes(filePath)
  if (bytes === undefined) {
    throw new Error('文件不存在')
  }
  const mime = guessMime(filePath)
  return {
    node: makeFileNode(filePath, bytes.byteLength),
    blob: new Blob([bytes], { type: mime }),
  }
}
