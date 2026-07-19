export type BuiltinFilesLocationId = 'local' | 'models3d' | 'source'

/** 动态挂载卷：`mount:{8位键}` */
export type MountFilesLocationId = `mount:${string}`

export type FilesLocationId = BuiltinFilesLocationId | MountFilesLocationId

export type FilesNodeKind = 'folder' | 'file'

/** 节点自身的文件属性（类 POSIX / Finder 信息，不依赖调用方写死位置） */
export type FilesNodeAttributes = {
  /** 是否允许修改内容、重命名、删除；文件夹为 false 时也不可在其下新建 */
  writable: boolean
}

export type FilesNode = {
  id: string
  locationId: FilesLocationId
  /** 根目录下的项为 undefined */
  parentId: string | undefined
  name: string
  kind: FilesNodeKind
  mimeType: string | undefined
  byteSize: number
  createdAt: number
  updatedAt: number
  attributes: FilesNodeAttributes
}

export type FilesLocation = {
  id: FilesLocationId
  label: string
  /**
   * 挂载面默认是否允许新建。
   * 具体节点是否可写以 `FilesNode.attributes.writable` 为准；
   * 投影只读卷会把其下节点属性标为不可写。
   */
  writable: boolean
}

export const FILES_LOCATIONS: readonly FilesLocation[] = [
  { id: 'local', label: '用户文件', writable: true },
  { id: 'models3d', label: '3D 模型', writable: false },
  { id: 'source', label: '系统文件', writable: false },
]

export const FILES_TEXT_MIME = 'text/plain'
export const FILES_GLTF_MIME = 'model/gltf+json'

export function isMountLocationId(id: string): id is MountFilesLocationId {
  return /^mount:[^:]+$/.test(id)
}

export function isMountNodeId(id: string): boolean {
  return /^mount:[^:]+:[df]:/.test(id)
}

export function parseMountLocationKey(locationId: FilesLocationId): string | undefined {
  if (!isMountLocationId(locationId)) return undefined
  return locationId.slice('mount:'.length)
}

export function makeMountLocationId(key: string): MountFilesLocationId {
  return `mount:${key}`
}

/** 约 8 位十六进制挂载键，足够区分少量挂载且路径更短 */
export function newMountLocationKey(existingIds?: ReadonlySet<string>): string {
  const taken = existingIds ?? new Set<string>()
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const key = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
    const id = makeMountLocationId(key)
    if (!taken.has(id)) return key
  }
  return crypto.randomUUID().replaceAll('-', '').slice(0, 8)
}

export function isFilesLocationWritable(locationId: FilesLocationId): boolean {
  if (isMountLocationId(locationId)) return true
  return FILES_LOCATIONS.find((item) => item.id === locationId)?.writable === true
}

export function defaultFilesNodeAttributes(locationId: FilesLocationId): FilesNodeAttributes {
  return { writable: isFilesLocationWritable(locationId) }
}

export function isFilesNodeWritable(node: Pick<FilesNode, 'attributes'>): boolean {
  return node.attributes.writable === true
}
