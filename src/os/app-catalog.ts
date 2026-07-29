import { sanitizeFilesPathSegment } from '../apps/files/files-path.ts'
import { BUILTIN_APP_ABOUT } from './builtin-app-about-data.ts'
import { loadInstalledApps } from './generated-apps-storage.ts'
import type { AppId, GeneratedAppId } from './types.ts'

export type AppCatalogKind = 'builtin' | 'generated'

export type AppCatalogEntry = {
  id: AppId
  kind: AppCatalogKind
  name: string
  /** 例如 `邮件.app` */
  bundleName: string
  /** `/Applications` 卷内相对路径，例如 `邮件.app` */
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

let registryModulePromise: Promise<typeof import('./app-registry.tsx')> | undefined
let cachedEntries: AppCatalogEntry[] | undefined
let cachedByBundlePath: Map<string, AppCatalogEntry> | undefined
let catalogLoadPromise: Promise<AppCatalogEntry[]> | undefined

function loadAppRegistryModule(): Promise<typeof import('./app-registry.tsx')> {
  registryModulePromise ??= import('./app-registry.tsx')
  return registryModulePromise
}

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

function makeBundleName(name: string, id: AppId, usedNames: Set<string>): string {
  const stem = sanitizeFilesPathSegment(name.trim() || '未命名')
  let candidate = `${stem}${APP_BUNDLE_SUFFIX}`
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate)
    return candidate
  }

  const suffix = id.includes(':') ? id.split(':')[1]!.slice(0, 8) : id
  candidate = `${stem} (${suffix})${APP_BUNDLE_SUFFIX}`
  let n = 2
  while (usedNames.has(candidate)) {
    candidate = `${stem} (${suffix}-${n})${APP_BUNDLE_SUFFIX}`
    n += 1
  }
  usedNames.add(candidate)
  return candidate
}

async function buildAppCatalogEntries(): Promise<AppCatalogEntry[]> {
  const { APP_REGISTRY } = await loadAppRegistryModule()
  const usedNames = new Set<string>()
  const entries: AppCatalogEntry[] = []

  for (const app of APP_REGISTRY) {
    const about = BUILTIN_APP_ABOUT[app.id]
    const bundleName = makeBundleName(app.name, app.id, usedNames)
    entries.push({
      id: app.id,
      kind: 'builtin',
      name: app.name,
      bundleName,
      bundlePath: bundleName,
      version: about?.version,
      description: about?.paragraphs?.[0],
      removable: false,
      sourceRootPath: `src/apps/${app.id}`,
    })
  }

  for (const app of loadInstalledApps()) {
    const bundleName = makeBundleName(app.name, app.id, usedNames)
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

export { loadAppRegistryModule }
