/**
 * 应用内部数据 API：读写各自独立数据目录 /dev/apps/{appId}/Data。
 * 文件管理器 / 终端按节点属性访问（/Applications 投影只读）；
 * 应用写入统一走本模块（自动建目录 + 独立配额预检）。
 */
import { appDataRootPath, ensureAppDataRoot } from './files-app-data-root.ts'
import { assertAppDataCapacity } from './files-app-data-quota.ts'
import { estimateTextBytes } from './files-storage.ts'
import type { FilesNode } from './files-types.ts'
import {
  listDirectory,
  readFileBlob,
  readTextFile,
  resolveNodeByAbsolutePath,
  upsertFilesBatch,
} from './files-vfs.ts'

/** Data 根 + 相对子路径（相对路径中的 `/` 即层级分隔） */
function joinAppDataPath(appId: string, relativePath: string): string {
  const rel = relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) {
    throw new Error('应用数据文件路径不能为空')
  }
  return `${appDataRootPath(appId)}/${rel}`
}

/** 读取应用数据文本文件；不存在返回 undefined */
export async function readAppDataText(
  appId: string,
  relativePath: string,
): Promise<string | undefined> {
  const absolutePath = joinAppDataPath(appId, relativePath)
  const node = await resolveNodeByAbsolutePath(absolutePath)
  if (!node || node.kind !== 'file') return undefined
  const { text } = await readTextFile(absolutePath)
  return text
}

/** 读取应用数据二进制文件；不存在返回 undefined */
export async function readAppDataBlob(
  appId: string,
  relativePath: string,
): Promise<Blob | undefined> {
  const absolutePath = joinAppDataPath(appId, relativePath)
  const node = await resolveNodeByAbsolutePath(absolutePath)
  if (!node || node.kind !== 'file') return undefined
  const { blob } = await readFileBlob(absolutePath)
  return blob
}

/** 写入应用数据文本文件（自动建目录；父目录自动补齐） */
export async function writeAppDataText(
  appId: string,
  relativePath: string,
  text: string,
): Promise<void> {
  await ensureAppDataRoot(appId)
  await assertAppDataCapacity(estimateTextBytes(text))
  await upsertFilesBatch([{ path: joinAppDataPath(appId, relativePath), text }])
}

/** 写入应用数据二进制文件（自动建目录；父目录自动补齐） */
export async function writeAppDataBytes(
  appId: string,
  relativePath: string,
  bytes: ArrayBuffer,
): Promise<void> {
  await ensureAppDataRoot(appId)
  await assertAppDataCapacity(bytes.byteLength)
  await upsertFilesBatch([{ path: joinAppDataPath(appId, relativePath), bytes }])
}

/** 列出应用数据目录下的直接子项（不存在时返回空数组） */
export async function listAppDataFiles(appId: string): Promise<FilesNode[]> {
  const root = appDataRootPath(appId)
  const rootNode = await resolveNodeByAbsolutePath(root)
  if (!rootNode || rootNode.kind !== 'folder') return []
  return listDirectory(rootNode.locationId, rootNode.id)
}
