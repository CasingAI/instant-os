import { AppIconNotificationBadge } from '../icons/app-icon-notification-badge.tsx'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { generatedAppIdToSlug } from '../apps/appstore/store-agent.ts'
import { APP_REGISTRY } from '../os/app-registry.tsx'
import {
  buildBuiltinIconContextMenuItems,
  buildGeneratedIconContextMenuItems,
} from '../os/build-icon-context-menu-items.ts'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useIconContextMenu } from '../os/icon-context-menu-context.tsx'
import { useOs } from '../os/os-context.tsx'
import { isGeneratedAppId, type GeneratedAppId } from '../os/types.ts'
import '../icons/app-icon-tile.css'
import './dock.css'

export function Dock() {
  const { windows, openApp, restoreWindow } = useOs()
  const { installedApps, openInstalledApp, openAppStoreDetail, pendingUpdateCount } =
    useGeneratedApps()
  const { showIconContextMenu } = useIconContextMenu()
  const dockApps = APP_REGISTRY.filter((app) => app.dock)
  const dockHidden = windows.some((window) => window.fullscreen && !window.minimized)

  const runningGeneratedApps = [...new Set(windows.map((window) => window.appId).filter(isGeneratedAppId))]
    .map((appId) => installedApps.find((app) => app.id === appId))
    .filter((app): app is NonNullable<typeof app> => app !== undefined)

  function handleGeneratedClick(appId: GeneratedAppId) {
    const minimized = windows.find((window) => window.appId === appId && window.minimized)
    if (minimized) {
      restoreWindow(minimized.id)
      return
    }
    openInstalledApp(appId)
  }

  return (
    <nav class={`dock${dockHidden ? ' dock--hidden' : ''}`} aria-label="程序坞">
      <div class="dock__plate">
        {dockApps.map((app) => {
          const isRunning = windows.some((window) => window.appId === app.id)
          const minimized = windows.find((window) => window.appId === app.id && window.minimized)

          const handleOpen = () => {
            if (minimized) {
              restoreWindow(minimized.id)
              return
            }
            openApp(app.id)
          }

          return (
            <button
              key={app.id}
              type="button"
              class={`dock__item${isRunning ? ' dock__item--running' : ''}`}
              aria-label={app.name}
              onClick={handleOpen}
              onContextMenu={(event) => {
                showIconContextMenu(event, buildBuiltinIconContextMenuItems(handleOpen))
              }}
            >
              <span class="dock__icon">
                <app.icon size={56} />
                {app.id === 'appstore' && <AppIconNotificationBadge count={pendingUpdateCount} />}
              </span>
              {isRunning && <span class="dock__indicator" />}
            </button>
          )
        })}
        {runningGeneratedApps.map((app) => {
          const isRunning = windows.some((window) => window.appId === app.id)
          const slug = generatedAppIdToSlug(app.id)

          const handleOpen = () => {
            handleGeneratedClick(app.id)
          }

          return (
            <button
              key={app.id}
              type="button"
              class={`dock__item${isRunning ? ' dock__item--running' : ''}`}
              aria-label={app.name}
              onClick={handleOpen}
              onContextMenu={(event) => {
                showIconContextMenu(
                  event,
                  buildGeneratedIconContextMenuItems({
                    onOpen: handleOpen,
                    onViewInAppStore: () => openAppStoreDetail(slug),
                  }),
                )
              }}
            >
              <span class="dock__icon">
                <GeneratedAppIcon
                  emoji={app.iconEmoji}
                  themeColor={app.themeColor}
                  size={56}
                />
              </span>
              {isRunning && <span class="dock__indicator" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
