/**
 * `/user` 根下固定特殊文件夹：Downloads、Musics、Pictures。
 * 已存在则沿用并视为特殊（禁止重命名/删除）；不存在则创建。内容可读写。
 */
import { osNowMs } from '../../os/os-clock.ts'
import { filesLocationPathRoot, joinFilesAbsolutePath, parseFilesAbsolutePath } from './files-path.ts'
import { createFolderNode, estimateNodeMetaBytes, listChildNodes, newFilesNodeId } from './files-storage.ts'
import { emitSystemVfsChange } from './files-system-vfs.ts'
import type { FilesNode, FilesNodeAttributes } from './files-types.ts'

const USER_ROOT = filesLocationPathRoot('local')

export const USER_SPECIAL_FOLDER_NAMES = ['Downloads', 'Musics', 'Pictures'] as const

export type UserSpecialFolderName = (typeof USER_SPECIAL_FOLDER_NAMES)[number]

const USER_SPECIAL_FOLDER_NAME_SET = new Set<string>(USER_SPECIAL_FOLDER_NAMES)

export const USER_SPECIAL_FOLDER_ATTRIBUTES: FilesNodeAttributes = {
  readable: true,
  writable: true,
}

export function userSpecialFolderPath(name: UserSpecialFolderName): string {
  return joinFilesAbsolutePath(USER_ROOT, name)
}

export const USER_SPECIAL_FOLDER_PATHS = USER_SPECIAL_FOLDER_NAMES.map(userSpecialFolderPath)

export function isUserSpecialFolderName(name: string): boolean {
  return USER_SPECIAL_FOLDER_NAME_SET.has(name)
}

/** `/user` 根下固定名的文件夹节点（按 location + parent + name 判定，无需解析路径） */
export function isUserSpecialFolderNode(
  node: Pick<FilesNode, 'locationId' | 'parentId' | 'name' | 'kind'>,
): boolean {
  return (
    node.kind === 'folder' &&
    node.locationId === 'local' &&
    node.parentId === undefined &&
    isUserSpecialFolderName(node.name)
  )
}

/** 绝对路径是否为 `/user/{Downloads|Musics|Pictures}` */
export function isUserSpecialFolderPath(absolutePath: string): boolean {
  const normalized = absolutePath.trim().replace(/\/+$/, '') || '/'
  const parsed = parseFilesAbsolutePath(normalized)
  return (
    parsed?.locationId === 'local' &&
    parsed.segments.length === 1 &&
    isUserSpecialFolderName(parsed.segments[0] ?? '')
  )
}

async function ensureUserSpecialFolder(name: UserSpecialFolderName): Promise<FilesNode> {
  const absolutePath = userSpecialFolderPath(name)
  const siblings = await listChildNodes('local', undefined)
  const existing = siblings.find((child) => child.name === name)
  if (existing) {
    if (existing.kind !== 'folder') {
      throw new Error(`路径冲突：${absolutePath} 不是文件夹`)
    }
    return existing
  }

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: 'local',
    parentId: undefined,
    name,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: USER_SPECIAL_FOLDER_ATTRIBUTES,
  }
  await createFolderNode({ node, metaBytes: estimateNodeMetaBytes(node) })
  return node
}

let ensureAllPromise: Promise<FilesNode[]> | undefined

/** 确保三个特殊文件夹存在（幂等；并发调用共用同一 Promise） */
export async function ensureUserSpecialFolders(): Promise<FilesNode[]> {
  if (!ensureAllPromise) {
    ensureAllPromise = (async () => {
      const before = await listChildNodes('local', undefined)
      const beforeIds = new Set(before.map((node) => node.id))
      const nodes = await Promise.all(
        USER_SPECIAL_FOLDER_NAMES.map((name) => ensureUserSpecialFolder(name)),
      )
      const created = nodes.some((node) => !beforeIds.has(node.id))
      if (created) {
        emitSystemVfsChange(USER_ROOT)
      }
      return nodes
    })().finally(() => {
      ensureAllPromise = undefined
    })
  }
  return ensureAllPromise
}
