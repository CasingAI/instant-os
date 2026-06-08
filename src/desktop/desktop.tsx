import type { ComponentType } from 'preact'
import { useState } from 'preact/hooks'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { generatedAppIdToSlug } from '../apps/appstore/store-agent.ts'
import { AppIconNotificationBadge } from '../icons/app-icon-notification-badge.tsx'
import { APP_REGISTRY } from '../os/app-registry.tsx'
import {
  buildBuiltinIconContextMenuItems,
  buildGeneratedIconContextMenuItems,
} from '../os/build-icon-context-menu-items.ts'
import { AppUninstallConfirmSheet } from '../os/app-uninstall-confirm-sheet.tsx'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useIconContextMenu } from '../os/icon-context-menu-context.tsx'
import { useOs } from '../os/os-context.tsx'
import type { BuiltinAppId, GeneratedAppId } from '../os/types.ts'
import '../icons/app-icon-tile.css'
import './desktop.css'

type DesktopIconProps = {
  appId: BuiltinAppId
  name: string
  Icon: ComponentType<{ size?: number }>
  badgeCount?: number
}

function DesktopIcon({ appId, name, Icon, badgeCount = 0 }: DesktopIconProps) {
  const { openApp } = useOs()
  const { showIconContextMenu } = useIconContextMenu()

  const handleOpen = () => {
    openApp(appId)
  }

  return (
    <button
      type="button"
      class="desktop-icon"
      onClick={handleOpen}
      onContextMenu={(event) => {
        showIconContextMenu(event, buildBuiltinIconContextMenuItems(handleOpen))
      }}
    >
      <span class="desktop-icon__image">
        <Icon size={72} />
        <AppIconNotificationBadge count={badgeCount} />
      </span>
      <span class="desktop-icon__label">{name}</span>
    </button>
  )
}

type GeneratedDesktopIconProps = {
  appId: GeneratedAppId
  name: string
  emoji: string
  themeColor: string
  progress?: number
  textLength?: number
}

function GeneratedDesktopIcon({
  appId,
  name,
  emoji,
  themeColor,
  progress,
  textLength,
}: GeneratedDesktopIconProps) {
  const { openInstalledApp, openMarketplaceDetail, uninstallApp } = useGeneratedApps()
  const { showIconContextMenu } = useIconContextMenu()
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false)
  const downloading = progress !== undefined && progress < 100
  const slug = generatedAppIdToSlug(appId)
  const canUninstall = !downloading

  const handleOpen = () => {
    if (!downloading) {
      openInstalledApp(appId)
    }
  }

  const handleConfirmUninstall = () => {
    uninstallApp(appId)
    setUninstallConfirmOpen(false)
  }

  return (
    <>
      <button
        type="button"
        class="desktop-icon"
        disabled={downloading}
        onClick={handleOpen}
        onContextMenu={(event) => {
          showIconContextMenu(
            event,
            buildGeneratedIconContextMenuItems({
              onOpen: handleOpen,
              onViewInMarketplace: () => openMarketplaceDetail(slug),
              onUninstall: canUninstall ? () => setUninstallConfirmOpen(true) : undefined,
              openDisabled: downloading,
            }),
          )
        }}
      >
        <span class="desktop-icon__image">
          <GeneratedAppIcon
            emoji={emoji}
            themeColor={themeColor}
            size={72}
            progress={progress}
            textLength={textLength}
          />
        </span>
        <span class="desktop-icon__label">{name}</span>
      </button>

      {uninstallConfirmOpen && (
        <AppUninstallConfirmSheet
          appName={name}
          onCancel={() => setUninstallConfirmOpen(false)}
          onConfirm={handleConfirmUninstall}
        />
      )}
    </>
  )
}

export function Desktop() {
  const { installedApps, pendingInstalls, pendingUpdateCount } = useGeneratedApps()
  const desktopApps = APP_REGISTRY.filter((app) => app.desktop)

  return (
    <section class="desktop" aria-label="桌面">
      <div class="desktop__grid">
        {desktopApps.map((app) => (
          <DesktopIcon
            key={app.id}
            appId={app.id}
            name={app.name}
            Icon={app.icon}
            badgeCount={app.id === 'appstore' ? pendingUpdateCount : 0}
          />
        ))}
        {installedApps
          .filter((app) => !pendingInstalls.some((item) => item.id === app.id))
          .map((app) => (
            <GeneratedDesktopIcon
              key={app.id}
              appId={app.id}
              name={app.name}
              emoji={app.iconEmoji}
              themeColor={app.themeColor}
            />
          ))}
        {pendingInstalls.map((item) => (
          <GeneratedDesktopIcon
            key={item.id}
            appId={item.id}
            name={item.listing.name}
            emoji={item.listing.iconEmoji}
            themeColor={item.listing.themeColor}
            progress={item.progress}
            textLength={item.textLength}
          />
        ))}
      </div>
    </section>
  )
}
