import { appBundleDirName } from '../apps/files/files-app-id.ts'
import { BUILTIN_APP_ABOUT } from './builtin-app-about-data.ts'
import {
  BUILTIN_APP_CATALOG_ORDER,
  BUILTIN_APP_DISPLAY_NAMES,
} from './builtin-app-display-names.ts'
import { loadInstalledApps } from './generated-apps-storage.ts'
import type { AppId, GeneratedAppId } from './types.ts'

export type AppCatalogKind = 'builtin' | 'generated'

export type AppCatalogEntry = {
  id: AppId
  kind: AppCatalogKind
  name: string
  /** 包目录名（含 `.app`），由 appId 派生，例如 `weather.app` / `gen_xxx.app` */
  bundleName: string
  /** `/Applications` 卷内相对路径，例如 `weather.app` */
  bundlePath: string
  version?: string
  description?: string
  removable: boolean
  iconEmoji?: string
  themeColor?: string
  /** 内置应用：Contents 映射的源码目录（如 `src/apps/mail`） */
  sourceRootPath?: string
}

const APP_BUNDLE_SUFFIX = '.app'

let cachedEntries: AppCatalogEntry[] | undefined
let cachedByBundlePath: Map<string, AppCatalogEntry> | undefined
let catalogLoadPromise: Promise<AppCatalogEntry[]> | undefined

export function isAppBundleName(name: string): boolean {
  return name.endsWith(APP_BUNDLE_SUFFIX)
}

export function invalidateAppCatalogCache(): void {
  cachedEntries = undefined
  cachedByBundlePath = undefined
  catalogLoadPromise = undefined
}

export function getCachedAppCatalogEntryByBundlePath(bundlePath: string): AppCatalogEntry | undefined {
  if (!cachedByBundlePath) return undefined
  const root = bundlePath.replace(/\/+$/, '').split('/')[0]
  if (!root) return undefined
  return cachedByBundlePath.get(root)
}

async function buildAppCatalogEntries(): Promise<AppCatalogEntry[]> {
  const entries: AppCatalogEntry[] = []

  for (const appId of BUILTIN_APP_CATALOG_ORDER) {
    const name = BUILTIN_APP_DISPLAY_NAMES[appId]
    const about = BUILTIN_APP_ABOUT[appId]
    const bundleName = appBundleDirName(appId)
    entries.push({
      id: appId,
      kind: 'builtin',
      name,
      bundleName,
      bundlePath: bundleName,
      version: about?.version,
      description: about?.paragraphs?.[0],
      removable: false,
      sourceRootPath: `src/apps/${appId}`,
    })
  }

  for (const app of loadInstalledApps()) {
    const bundleName = appBundleDirName(app.id)
    entries.push({
      id: app.id as GeneratedAppId,
      kind: 'generated',
      name: app.name,
      bundleName,
      bundlePath: bundleName,
      version: app.version,
      description: app.description,
      removable: true,
      iconEmoji: app.iconEmoji,
      themeColor: app.themeColor,
    })
  }

  return entries.sort((a, b) => a.bundleName.localeCompare(b.bundleName, 'zh-CN'))
}

/** 运行时应用目录：内置应用 + 已安装 gen 应用 */
export async function listAppCatalogEntries(): Promise<AppCatalogEntry[]> {
  if (cachedEntries) {
    return cachedEntries
  }
  catalogLoadPromise ??= buildAppCatalogEntries().then((entries) => {
    cachedEntries = entries
    cachedByBundlePath = new Map(entries.map((entry) => [entry.bundlePath, entry]))
    return entries
  })
  return catalogLoadPromise
}

export async function resolveAppCatalogEntryByBundlePath(
  bundlePath: string,
): Promise<AppCatalogEntry | undefined> {
  const normalized = bundlePath.replace(/\/+$/, '')
  const root = normalized.split('/')[0]
  if (!root) return undefined
  const entries = await listAppCatalogEntries()
  return entries.find((entry) => entry.bundlePath === root)
}

export async function resolveAppCatalogEntryById(appId: AppId): Promise<AppCatalogEntry | undefined> {
  const entries = await listAppCatalogEntries()
  return entries.find((entry) => entry.id === appId)
}
