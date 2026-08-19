import type { DesktopFolder, DesktopFolderId, DesktopItemId } from './desktop-folder-types.ts'
import { isDesktopFolderId } from './desktop-folder-types.ts'
import type { AppId, BuiltinAppId } from './types.ts'

/** 旧版曾把系统工具收进此文件夹；现已取消，迁移时拆回桌面。 */
export const SYSTEM_TOOLS_FOLDER_ID: DesktopFolderId = 'folder:system-tools'
export const DEVELOPER_TOOLS_FOLDER_ID: DesktopFolderId = 'folder:developer-tools'
export const DEVELOPER_TOOLS_FOLDER_NAME = '开发工具'

/** 出厂桌面只把开发工具收进独立文件夹；系统工具仍摊在桌面上。 */
export const LAUNCHER_LAYOUT_VERSION = 4

export const DEVELOPER_TOOL_APP_IDS: readonly BuiltinAppId[] = [
  'icode',
  'vscode',
  'produde',
  'github-desktop',
  'packages',
  'terminal',
  'simulated-terminal',
  'virtual-js',
  'page-devtools',
  'webview',
  'ui-kit',
  'llm-playground',
  'srml-demo',
  'attunebench',
  'model-vision',
  'speech',
]

const DEVELOPER_TOOL_APP_ID_SET = new Set<string>(DEVELOPER_TOOL_APP_IDS)

export function isDefaultFolderGroupedAppId(appId: string): boolean {
  return DEVELOPER_TOOL_APP_ID_SET.has(appId)
}

export function isDeveloperToolAppId(appId: string): boolean {
  return DEVELOPER_TOOL_APP_ID_SET.has(appId)
}

export function buildDefaultLauncherFolders(): DesktopFolder[] {
  return [
    {
      id: DEVELOPER_TOOLS_FOLDER_ID,
      name: DEVELOPER_TOOLS_FOLDER_NAME,
      appIds: [...DEVELOPER_TOOL_APP_IDS],
    },
  ]
}

type LauncherFolderLayout = {
  desktopIconOrder: DesktopItemId[]
  desktopFolders: DesktopFolder[]
}

function appsInNonDefaultFolders(folders: DesktopFolder[]): Set<AppId> {
  const set = new Set<AppId>()
  for (const folder of folders) {
    if (folder.id === DEVELOPER_TOOLS_FOLDER_ID || folder.id === SYSTEM_TOOLS_FOLDER_ID) {
      continue
    }
    for (const appId of folder.appIds) {
      set.add(appId)
    }
  }
  return set
}

function mergeCanonicalAppIds(
  canonical: readonly BuiltinAppId[],
  existing: readonly AppId[],
  skip: Set<AppId>,
): AppId[] {
  const next: AppId[] = []
  for (const appId of canonical) {
    if (skip.has(appId) || next.includes(appId)) {
      continue
    }
    next.push(appId)
  }
  for (const appId of existing) {
    if (skip.has(appId) || next.includes(appId) || !DEVELOPER_TOOL_APP_ID_SET.has(appId)) {
      continue
    }
    next.push(appId)
  }
  return next
}

/** 把仍散落在桌面上的开发工具收进默认文件夹；拆掉旧的「系统工具」文件夹。 */
export function applyDefaultLauncherFolders(layout: LauncherFolderLayout): LauncherFolderLayout {
  const skip = appsInNonDefaultFolders(layout.desktopFolders)
  const existingDev = layout.desktopFolders.find((folder) => folder.id === DEVELOPER_TOOLS_FOLDER_ID)
  const systemFolder = layout.desktopFolders.find((folder) => folder.id === SYSTEM_TOOLS_FOLDER_ID)

  const developerFolder: DesktopFolder = {
    id: DEVELOPER_TOOLS_FOLDER_ID,
    name: existingDev?.name.trim() ? existingDev.name : DEVELOPER_TOOLS_FOLDER_NAME,
    appIds: mergeCanonicalAppIds(DEVELOPER_TOOL_APP_IDS, existingDev?.appIds ?? [], skip),
  }

  const folders = [
    developerFolder,
    ...layout.desktopFolders.filter(
      (folder) => folder.id !== DEVELOPER_TOOLS_FOLDER_ID && folder.id !== SYSTEM_TOOLS_FOLDER_ID,
    ),
  ]

  const groupedNow = new Set<AppId>(developerFolder.appIds)
  const order = layout.desktopIconOrder.filter((itemId) => {
    if (itemId === SYSTEM_TOOLS_FOLDER_ID || itemId === DEVELOPER_TOOLS_FOLDER_ID) {
      return false
    }
    if (isDesktopFolderId(itemId)) {
      return true
    }
    return !groupedNow.has(itemId)
  })

  const spilled = (systemFolder?.appIds ?? []).filter(
    (appId) => !skip.has(appId) && !groupedNow.has(appId) && !order.includes(appId),
  )
  order.push(...spilled, DEVELOPER_TOOLS_FOLDER_ID)

  return {
    desktopIconOrder: order,
    desktopFolders: folders,
  }
}
