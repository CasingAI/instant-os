import { useEffect, useRef } from 'preact/hooks'
import { runAppDataMigrationOnce } from '../apps/files/files-app-data-migration.ts'
import { createTerminalInstantShellHost } from '../terminal/instant-shell/create-terminal-instant-shell-host.ts'
import { useDevExtApps } from './dev-ext-apps-context.tsx'
import { useGeneratedApps } from './generated-apps-context.tsx'
import { useOs } from './os-context.tsx'
import { startStartupItemsService } from './startup-items-service.ts'

/**
 * 桌面就绪后执行一次用户配置的启动项。
 * 放在 GeneratedAppsProvider 内，以便 instant.listApps / openApp 能覆盖生成应用与外链应用。
 */
export function StartupItemsBootstrap() {
  const {
    windows,
    openApp,
    openGeneratedApp,
    openExtApp,
    focusWindow,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
    restoreWindow,
    toggleFullscreen,
    toggleMaximize,
  } = useOs()
  const { installedApps } = useGeneratedApps()
  const { sessionExtApps } = useDevExtApps()

  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const installedAppsRef = useRef(installedApps)
  installedAppsRef.current = installedApps
  const sessionExtAppsRef = useRef(sessionExtApps)
  sessionExtAppsRef.current = sessionExtApps
  const openAppRef = useRef(openApp)
  openAppRef.current = openApp
  const openGeneratedAppRef = useRef(openGeneratedApp)
  openGeneratedAppRef.current = openGeneratedApp
  const openExtAppRef = useRef(openExtApp)
  openExtAppRef.current = openExtApp
  const focusWindowRef = useRef(focusWindow)
  focusWindowRef.current = focusWindow
  const closeWindowRef = useRef(closeWindow)
  closeWindowRef.current = closeWindow
  const closeWindowsForAppRef = useRef(closeWindowsForApp)
  closeWindowsForAppRef.current = closeWindowsForApp
  const minimizeWindowRef = useRef(minimizeWindow)
  minimizeWindowRef.current = minimizeWindow
  const restoreWindowRef = useRef(restoreWindow)
  restoreWindowRef.current = restoreWindow
  const toggleFullscreenRef = useRef(toggleFullscreen)
  toggleFullscreenRef.current = toggleFullscreen
  const toggleMaximizeRef = useRef(toggleMaximize)
  toggleMaximizeRef.current = toggleMaximize

  useEffect(() => {
    // 应用数据目录迁移（幂等；失败项下次启动重试）
    void runAppDataMigrationOnce().catch(() => undefined)

    const host = createTerminalInstantShellHost({
      getWindows: () => windowsRef.current,
      openApp: (appId, options) => {
        openAppRef.current(appId, options)
      },
      openGeneratedApp: (appId, title) => {
        openGeneratedAppRef.current(appId, title)
      },
      openExtApp: (appId, title) => {
        openExtAppRef.current(appId, title)
      },
      getInstalledGeneratedApps: () => installedAppsRef.current,
      getSessionExtApps: () => sessionExtAppsRef.current,
      focusWindow: (windowId) => {
        focusWindowRef.current(windowId)
      },
      closeWindow: (windowId) => {
        closeWindowRef.current(windowId)
      },
      closeWindowsForApp: (appId) => {
        closeWindowsForAppRef.current(appId)
      },
      minimizeWindow: (windowId) => {
        minimizeWindowRef.current(windowId)
      },
      restoreWindow: (windowId) => {
        restoreWindowRef.current(windowId)
      },
      toggleFullscreen: (windowId) => {
        toggleFullscreenRef.current(windowId)
      },
      toggleMaximize: (windowId) => {
        toggleMaximizeRef.current(windowId)
      },
      getCwd: () => '/user',
      getFsMode: () => 'normal',
      getTerminalSessionId: () => 'startup-items',
      noteExternalChangeSet: () => undefined,
      isBusy: () => false,
      confirmClose: async () => true,
    })
    return startStartupItemsService(host)
  }, [])

  return null
}
