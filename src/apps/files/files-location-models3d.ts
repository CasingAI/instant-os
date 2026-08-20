import {
  catalogEntriesForSource,
  catalogEntryById,
  INSTANT3D_SOURCE_PACKS,
  type Instant3dSourceId,
} from '../../assets/3d/asset-catalog.ts'
import { FILES_GLTF_MIME, type FilesNode } from './files-types.ts'

const LOCATION_ID = 'models3d' as const
const EPOCH = 0
const READONLY_ATTRIBUTES = { readable: true, writable: false } as const

function packFolderId(packId: string): string {
  return `models3d:d:${packId}`
}

function modelFileId(entryId: string): string {
  return `models3d:f:${entryId}`
}

function parsePackId(folderId: string): Instant3dSourceId | undefined {
  if (!folderId.startsWith('models3d:d:')) return undefined
  const id = folderId.slice('models3d:d:'.length)
  return INSTANT3D_SOURCE_PACKS.some((pack) => pack.id === id)
    ? (id as Instant3dSourceId)
    : undefined
}

function parseModelId(fileId: string): string | undefined {
  if (!fileId.startsWith('models3d:f:')) return undefined
  return fileId.slice('models3d:f:'.length)
}

function packNode(packId: Instant3dSourceId): FilesNode | undefined {
  const pack = INSTANT3D_SOURCE_PACKS.find((item) => item.id === packId)
  if (!pack) return undefined
  return {
    id: packFolderId(pack.id),
    locationId: LOCATION_ID,
    parentId: undefined,
    name: pack.title,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    attributes: READONLY_ATTRIBUTES,
  }
}

function modelNode(entryId: string): FilesNode | undefined {
  const entry = catalogEntryById(entryId)
  if (!entry) return undefined
  const fileName = `${entry.label}.gltf`
  return {
    id: modelFileId(entry.id),
    locationId: LOCATION_ID,
    parentId: packFolderId(entry.source),
    name: fileName,
    kind: 'file',
    mimeType: FILES_GLTF_MIME,
    byteSize: 0,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    attributes: READONLY_ATTRIBUTES,
  }
}

export function getModels3dNode(id: string): FilesNode | undefined {
  const packId = parsePackId(id)
  if (packId) return packNode(packId)
  const modelId = parseModelId(id)
  if (modelId) return modelNode(modelId)
  return undefined
}

export function listModels3dDirectory(folderId: string | undefined): FilesNode[] {
  if (folderId === undefined) {
    return INSTANT3D_SOURCE_PACKS.map((pack) => packNode(pack.id)!).filter(Boolean)
  }

  const packId = parsePackId(folderId)
  if (!packId) return []

  return catalogEntriesForSource(packId)
    .map((entry) => modelNode(entry.id)!)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export function resolveModels3dPath(folderId: string | undefined): FilesNode[] {
  if (folderId === undefined) return []
  const packId = parsePackId(folderId)
  if (!packId) return []
  const node = packNode(packId)
  return node ? [node] : []
}

export async function readModels3dText(id: string): Promise<{ node: FilesNode; text: string }> {
  const modelId = parseModelId(id)
  if (!modelId) {
    throw new Error('文件不存在')
  }
  const entry = catalogEntryById(modelId)
  const node = modelNode(modelId)
  if (!entry || !node) {
    throw new Error('文件不存在')
  }

  const response = await fetch(entry.url)
  if (!response.ok) {
    throw new Error(`无法读取模型（HTTP ${response.status}）`)
  }
  const text = await response.text()
  return {
    node: { ...node, byteSize: new TextEncoder().encode(text).length },
    text,
  }
}

export async function readModels3dBlob(id: string): Promise<{ node: FilesNode; blob: Blob }> {
  const modelId = parseModelId(id)
  if (!modelId) {
    throw new Error('文件不存在')
  }
  const entry = catalogEntryById(modelId)
  const node = modelNode(modelId)
  if (!entry || !node) {
    throw new Error('文件不存在')
  }

  const response = await fetch(entry.url)
  if (!response.ok) {
    throw new Error(`无法读取模型（HTTP ${response.status}）`)
  }
  const blob = await response.blob()
  const typed =
    blob.type && blob.type !== 'application/octet-stream'
      ? blob
      : new Blob([blob], { type: FILES_GLTF_MIME })
  return {
    node: { ...node, byteSize: typed.size },
    blob: typed,
  }
}

/** 从节点 id 解析 catalog 条目 id（`models3d:f:{id}`） */
export function parseModels3dCatalogId(id: string): string | undefined {
  return parseModelId(id)
}
