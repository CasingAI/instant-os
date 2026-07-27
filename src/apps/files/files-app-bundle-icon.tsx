import type { ComponentType } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'
import {
  getCachedAppCatalogEntryByBundlePath,
  listAppCatalogEntries,
  loadAppRegistryModule,
  resolveAppCatalogEntryByBundlePath,
  type AppCatalogEntry,
} from '../../os/app-catalog.ts'
import type { BuiltinAppId } from '../../os/types.ts'
import { parseApplicationsDirPath } from './files-location-applications.ts'
import type { FilesNode } from './files-types.ts'
import '../../icons/app-icon-tile.css'

type FilesNodeIconSize = 'grid' | 'list'

const GRID_ICON_SIZE = 52
const LIST_ICON_SIZE = 18

const builtinIconCache = new Map<BuiltinAppId, ComponentType<{ size?: number }>>()
let preloadPromise: Promise<void> | undefined

function getCachedBuiltinIcon(appId: BuiltinAppId): ComponentType<{ size?: number }> | undefined {
  return builtinIconCache.get(appId)
}

function cacheBuiltinIcon(appId: BuiltinAppId, icon: ComponentType<{ size?: number }> | undefined): void {
  if (icon) {
    builtinIconCache.set(appId, icon)
  }
}

/** 进入「应用程序」卷前预加载目录与内置图标，避免列表项逐个闪灰 */
export function preloadAppBundleIcons(): Promise<void> {
  preloadPromise ??= (async () => {
    const entries = await listAppCatalogEntries()
    const { getAppDefinition } = await loadAppRegistryModule()
    for (const entry of entries) {
      if (entry.kind !== 'builtin') continue
      const appId = entry.id as BuiltinAppId
      if (builtinIconCache.has(appId)) continue
      cacheBuiltinIcon(appId, getAppDefinition(appId)?.icon)
    }
  })()
  return preloadPromise
}

type FilesAppBundleIconProps = {
  node: FilesNode
  size: FilesNodeIconSize
}

function resolveInitialBundleIconState(node: FilesNode): {
  entry: AppCatalogEntry | undefined
  BuiltinIcon: ComponentType<{ size?: number }> | undefined
} {
  const bundlePath = parseApplicationsDirPath(node.id)
  if (!bundlePath) {
    return { entry: undefined, BuiltinIcon: undefined }
  }
  const entry = getCachedAppCatalogEntryByBundlePath(bundlePath)
  const BuiltinIcon =
    entry?.kind === 'builtin' ? getCachedBuiltinIcon(entry.id as BuiltinAppId) : undefined
  return { entry, BuiltinIcon }
}

export function FilesAppBundleIcon({ node, size }: FilesAppBundleIconProps) {
  const initial = resolveInitialBundleIconState(node)
  const [entry, setEntry] = useState(initial.entry)
  // 图标是函数组件；直接传给 useState 会被当作 lazy initializer 立即调用
  const [BuiltinIcon, setBuiltinIcon] = useState(() => initial.BuiltinIcon)

  useEffect(() => {
    const bundlePath = parseApplicationsDirPath(node.id)
    if (!bundlePath) return

    const cachedEntry = getCachedAppCatalogEntryByBundlePath(bundlePath)
    if (cachedEntry) {
      setEntry(cachedEntry)
      if (cachedEntry.kind === 'builtin') {
        const icon = getCachedBuiltinIcon(cachedEntry.id as BuiltinAppId)
        if (icon) {
          setBuiltinIcon(() => icon)
          return
        }
      } else {
        return
      }
    }

    let cancelled = false
    void resolveAppCatalogEntryByBundlePath(bundlePath).then(async (resolved) => {
      if (cancelled || !resolved) return
      setEntry(resolved)
      if (resolved.kind !== 'builtin') return

      const appId = resolved.id as BuiltinAppId
      const cachedIcon = getCachedBuiltinIcon(appId)
      if (cachedIcon) {
        setBuiltinIcon(() => cachedIcon)
        return
      }

      const { getAppDefinition } = await loadAppRegistryModule()
      if (cancelled) return
      const icon = getAppDefinition(appId)?.icon
      cacheBuiltinIcon(appId, icon)
      setBuiltinIcon(() => icon)
    })

    return () => {
      cancelled = true
    }
  }, [node.id])

  const iconSize = size === 'list' ? LIST_ICON_SIZE : GRID_ICON_SIZE
  const rootClass = `files-node-icon files-node-icon--${size} files-node-icon--app-bundle`

  if (entry?.kind === 'generated' && entry.iconEmoji && entry.themeColor) {
    return (
      <span class={rootClass} aria-hidden="true">
        <GeneratedAppIcon emoji={entry.iconEmoji} themeColor={entry.themeColor} size={iconSize} />
      </span>
    )
  }

  if (entry?.kind === 'builtin' && BuiltinIcon) {
    const Icon = BuiltinIcon
    return (
      <span class={rootClass} aria-hidden="true">
        <Icon size={iconSize} />
      </span>
    )
  }

  return (
    <span class={`${rootClass} files-node-icon--app-bundle-loading`} aria-hidden="true">
      <AppIconTile color="#a8a8a8" size={iconSize}>
        <span class="files-node-icon__app-bundle-placeholder" />
      </AppIconTile>
    </span>
  )
}
