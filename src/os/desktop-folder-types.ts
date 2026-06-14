import type { AppId } from './types.ts'

export type DesktopFolderId = `folder:${string}`

export type DesktopFolder = {
  id: DesktopFolderId
  name: string
  appIds: AppId[]
}

export type DesktopItemId = AppId | DesktopFolderId

export function isDesktopFolderId(id: string): id is DesktopFolderId {
  return id.startsWith('folder:')
}

export function createDesktopFolderId(): DesktopFolderId {
  return `folder:${crypto.randomUUID()}`
}

export const DEFAULT_FOLDER_NAME = '文件夹'
