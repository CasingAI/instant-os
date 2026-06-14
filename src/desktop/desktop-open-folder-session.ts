import type { DesktopFolderId } from '../os/desktop-folder-types.ts'

type OpenDesktopFolderListener = () => void

let closeOpenFolder: (() => void) | undefined
let openFolder: ((folderId: DesktopFolderId) => void) | undefined
let openFolderId: DesktopFolderId | undefined
const listeners = new Set<OpenDesktopFolderListener>()

function notifyOpenDesktopFolderChange() {
  for (const listener of listeners) {
    listener()
  }
}

export function getOpenDesktopFolderId(): DesktopFolderId | undefined {
  return openFolderId
}

export function setOpenDesktopFolderId(folderId: DesktopFolderId | undefined) {
  if (openFolderId === folderId) {
    return
  }
  openFolderId = folderId
  notifyOpenDesktopFolderChange()
}

export function subscribeOpenDesktopFolderId(listener: OpenDesktopFolderListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function registerCloseOpenDesktopFolder(handler: (() => void) | undefined) {
  closeOpenFolder = handler
}

export function registerOpenDesktopFolder(handler: ((folderId: DesktopFolderId) => void) | undefined) {
  openFolder = handler
}

export function closeOpenDesktopFolder() {
  closeOpenFolder?.()
}

export function openDesktopFolder(folderId: DesktopFolderId) {
  openFolder?.(folderId)
}

export function toggleDesktopFolder(folderId: DesktopFolderId) {
  if (openFolderId === folderId) {
    closeOpenDesktopFolder()
    return
  }
  openFolder?.(folderId)
}
