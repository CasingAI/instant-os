export type BuiltinFilesLocationId =
  | 'local'
  | 'applications'
  | 'models3d'
  | 'source'
  | 'dev'
  | 'tmp'
  | 'trash'

/** 动态挂载卷：`mount:{文件夹名键}`，键由本机文件夹名派生，便于稳定路径 */
export type MountFilesLocationId = `mount:${string}`

/** 磁盘镜像挂载卷：`image:{镜像名键}` */
export type ImageFilesLocationId = `image:${string}`

export type FilesLocationId = BuiltinFilesLocationId | MountFilesLocationId | ImageFilesLocationId

export type FilesNodeKind = 'folder' | 'file' | 'symlink'

/** 节点自身的文件属性（类 POSIX / Finder 信息，不依赖调用方写死位置） */
export type FilesNodeAttributes = {
  /** 是否允许读取；当前用户侧不拦截读取，默认 true，为以后预留 */
  readable: boolean
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
  /**
   * 内容版本戳：每次写入文件正文时刷新（随机 UUID）。
   * 仅文件有意义；文件夹 / 旧记录可能缺省。
   */
  contentRevisionId?: string
  /**
   * 机会压缩偏好：开启后尽量以稀疏分块存储（缺席块 = 全零，写零打洞）。
   * 仅文件有意义；旧数据缺省为未开启。
   */
  sparse?: boolean
  /**
   * 符号链接目标（相对或绝对路径字符串）。
   * 仅 `kind === 'symlink'` 有意义；无独立 blob。
   */
  target?: string
  /**
   * 废纸篓来源记录：被删除（移入废纸篓）前的原位置，供恢复。
   * 仅位于废纸篓卷的节点有意义；普通节点缺失。
   */
  trashOrigin?: {
    locationId: FilesLocationId
    /** 原父目录 id（卷根为 undefined） */
    parentId: string | undefined
    /** 原名（移入废纸篓时可能因冲突被改名） */
    name: string
  }
  attributes: FilesNodeAttributes
}

/** 第一期允许创建 symlink 的卷（挂载卷 / 投影卷拒绝） */
export function canCreateSymlinkOnLocation(locationId: FilesLocationId): boolean {
  return locationId === 'local' || locationId === 'dev' || locationId === 'tmp'
}

/** 每次内容写入时生成的版本戳 */
export function newContentRevisionId(): string {
  return crypto.randomUUID()
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
  unreadableReason?: string
}

export const FILES_LOCATIONS: readonly FilesLocation[] = [
  { id: 'local', label: '用户文件', writable: true },
  { id: 'applications', label: '应用程序', writable: false },
  { id: 'dev', label: '开发者数据', writable: true },
  { id: 'tmp', label: '临时文件', writable: true },
  { id: 'models3d', label: '3D 模型', writable: false },
  { id: 'source', label: '系统', writable: false },
  { id: 'trash', label: '废纸篓', writable: true },
]

export const FILES_TEXT_MIME = 'text/plain'
export const FILES_GLTF_MIME = 'model/gltf+json'

export function isMountLocationId(id: string): id is MountFilesLocationId {
  return /^mount:[^:]+$/.test(id)
}

/** 是否为废纸篓卷（删除后暂存、可恢复的独立容器） */
export function isTrashLocationId(id: string): boolean {
  return id === 'trash'
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

export function isImageLocationId(id: string): id is ImageFilesLocationId {
  return /^image:[^:]+$/.test(id)
}

export function isImageNodeId(id: string): boolean {
  return /^image:[^:]+:[df]:/.test(id)
}

export function parseImageLocationKey(locationId: FilesLocationId): string | undefined {
  if (!isImageLocationId(locationId)) return undefined
  return locationId.slice('image:'.length)
}

export function makeImageLocationId(key: string): ImageFilesLocationId {
  return `image:${key}`
}

export function newImageLocationKey(
  fileName: string,
  existingIds?: ReadonlySet<string>,
): string {
  const taken = existingIds ?? new Set<string>()
  const base = mountKeyFromFolderName(fileName.replace(/\.(img|raw|ima|dsk)$/i, '') || fileName)
  let key = base
  let suffix = 2
  while (taken.has(makeImageLocationId(key))) {
    const candidate = `${base}-${suffix}`
    key =
      candidate.length <= MAX_MOUNT_KEY_LENGTH
        ? candidate
        : `${base.slice(0, Math.max(1, MAX_MOUNT_KEY_LENGTH - `-${suffix}`.length))}-${suffix}`
    suffix += 1
  }
  return key
}

const MOUNT_KEY_FORBIDDEN = /[/\\:\u0000-\u001f\u007f]/
const MAX_MOUNT_KEY_LENGTH = 64

/**
 * 由本机文件夹名生成挂载键（路径段安全）。
 * 同名文件夹卸载后再挂会落到同一 `/mount/{键}`；并挂冲突时追加 -2、-3…
 */
export function mountKeyFromFolderName(folderName: string): string {
  let key = folderName
    .trim()
    .replace(MOUNT_KEY_FORBIDDEN, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!key || key === '.' || key === '..') key = 'folder'
  if (key.length > MAX_MOUNT_KEY_LENGTH) {
    key = key.slice(0, MAX_MOUNT_KEY_LENGTH).replace(/-+$/g, '') || 'folder'
  }
  return key
}

/** 为挂载分配键：优先用文件夹名；与已有 id 冲突则加数字后缀 */
export function newMountLocationKey(
  folderName: string,
  existingIds?: ReadonlySet<string>,
): string {
  const taken = existingIds ?? new Set<string>()
  const base = mountKeyFromFolderName(folderName)
  let key = base
  let suffix = 2
  while (taken.has(makeMountLocationId(key))) {
    const candidate = `${base}-${suffix}`
    key =
      candidate.length <= MAX_MOUNT_KEY_LENGTH
        ? candidate
        : `${base.slice(0, Math.max(1, MAX_MOUNT_KEY_LENGTH - `-${suffix}`.length))}-${suffix}`
    suffix += 1
  }
  return key
}

export function isFilesLocationWritable(locationId: FilesLocationId): boolean {
  if (isMountLocationId(locationId) || isImageLocationId(locationId)) return true
  return FILES_LOCATIONS.find((item) => item.id === locationId)?.writable === true
}

export function defaultFilesNodeAttributes(locationId: FilesLocationId): FilesNodeAttributes {
  return { readable: true, writable: isFilesLocationWritable(locationId) }
}

/** 旧记录可能缺字段；读取时按位置默认补齐 */
export function normalizeFilesNodeAttributes(
  locationId: FilesLocationId,
  attributes: Partial<FilesNodeAttributes> | undefined,
): FilesNodeAttributes {
  const defaults = defaultFilesNodeAttributes(locationId)
  return {
    readable: attributes?.readable ?? defaults.readable,
    writable: attributes?.writable ?? defaults.writable,
  }
}

export function isFilesNodeReadable(node: Pick<FilesNode, 'attributes'>): boolean {
  return node.attributes.readable === true
}

export function isFilesNodeWritable(node: Pick<FilesNode, 'attributes'>): boolean {
  return node.attributes.writable === true
}

/** 卷根（虚拟条目）的属性：与 files-api volumeRootEntry 一致 */
export function filesVolumeRootAttributes(locationId: FilesLocationId): FilesNodeAttributes {
  if (locationId === 'dev') {
    return { readable: true, writable: false }
  }
  return defaultFilesNodeAttributes(locationId)
}

/** 信息面板权限文案 */
export function formatFilesNodePermissionLabel(node: Pick<FilesNode, 'attributes'>): string {
  if (isFilesNodeWritable(node)) return '可读写'
  if (isFilesNodeReadable(node)) return '只读'
  return '不可访问'
}
