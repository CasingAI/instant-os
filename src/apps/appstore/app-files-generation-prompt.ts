import { APP_CAPABILITY_TAG_FILES, hasAppCapabilityTag } from './app-capability-tags.ts'
import type { StoreListing, StoreListingDetail } from './types.ts'

export function resolveAppFilesGenerationOptions(
  listing: StoreListing,
  _detail?: Partial<StoreListingDetail>,
  _existingHtml?: string,
): { isFiles: boolean } {
  return { isFiles: hasAppCapabilityTag(listing.tags, APP_CAPABILITY_TAG_FILES) }
}

export const APP_STORE_FILES_RUNTIME_SECTION = `【文件运行时】
宿主为微应用注入 InstantOS.files（全局绝对路径句柄），由系统 Files VFS 执行，可读写卷受卷属性约束。

路径约定：
- /user — 本机用户文件（可读写）
- /models — 3D 模型（只读）
- /system — 系统源码快照（只读）
- /mount/{8位键}/… — 用户挂载的本机文件夹（可读写）

API（全部返回 Promise）：
- InstantOS.files.listVolumes() → { path, label, writable }[]
- InstantOS.files.list(path) → 目录条目数组
- InstantOS.files.stat(path) → 条目或 null
- InstantOS.files.readText(path) → string
- InstantOS.files.writeText(path, text) → 条目（仅覆写已存在文件）
- InstantOS.files.createText(path, text?) → 条目（新建，不可覆盖）
- InstantOS.files.mkdir(path) → 条目（新建文件夹，父目录须存在）
- InstantOS.files.rename(path, nextName) → 条目
- InstantOS.files.remove(path) → void

条目字段：path、name、kind（file|folder）、mimeType?、byteSize、createdAt、updatedAt、writable。

注意：禁止直接访问宿主磁盘 API；必须走 InstantOS.files。UI 须处理加载与错误。`

export function buildAppFilesSystemPromptExtension(): string {
  return APP_STORE_FILES_RUNTIME_SECTION
}

export function buildAppFilesUserPromptSection(): string {
  return [
    '【文件应用】',
    '应用需在运行时通过 InstantOS.files 访问系统文件。',
    '- 一律使用全局绝对路径（如 /user/笔记.txt）',
    '- 列表/读写/创建/重命名/删除见 InstantOS.files.*',
    '- 只读卷不可写入；展示加载与错误状态',
  ].join('\n')
}
