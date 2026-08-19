import { useMemo, useRef } from 'preact/hooks'
import type { GeneratedAppRecord } from '../apps/appstore/types.ts'
import { createTerminalInstantShellHost } from '../terminal/instant-shell/create-terminal-instant-shell-host.ts'
import type {
  InstantShellHost,
  InstantShellOpenAppOptions,
} from '../terminal/instant-shell/instant-shell-types.ts'
import { useDevExtApps } from './dev-ext-apps-context.tsx'
import { useGeneratedApps } from './generated-apps-context.tsx'
import type { ExtAppRecord } from './ext-app-types.ts'
import { useOs } from './os-context.tsx'
import type { AppId, WindowState } from './types.ts'

type StartupItemsOsLive = {
  windows: WindowState[]
  openApp: (appId: AppId, options?: InstantShellOpenAppOptions) => void
  openGeneratedApp: (appId: `gen:${string}`, title: string) => void
  openExtApp: (appId: `ext:${string}`, title: string) => void
  installedApps: GeneratedAppRecord[]
  sessionExtApps: ExtAppRecord[]
  focusWindow: (windowId: string) => void
  closeWindow: (windowId: string) => void
  closeWindowsForApp: (appId: AppId) => void
  minimizeWindow: (windowId: string) => void
  restoreWindow: (windowId: string) => void
  toggleFullscreen: (windowId: string) => void
  toggleMaximize: (windowId: string) => void
}

/** 启动项执行用的 InstantShellHost（cwd=/user，不打开终端窗口）。 */
export function createStartupItemsShellHost(getLive: () => StartupItemsOsLive): InstantShellHost {
  return createTerminalInstantShellHost({
    getWindows: () => getLive().windows,
    openApp: (appId, options) => {
      getLive().openApp(appId, options)
    },
    openGeneratedApp: (appId, title) => {
      getLive().openGeneratedApp(appId, title)
    },
    openExtApp: (appId, title) => {
      getLive().openExtApp(appId, title)
    },
    getInstalledGeneratedApps: () => getLive().installedApps,
    getSessionExtApps: () => getLive().sessionExtApps,
    focusWindow: (windowId) => {
      getLive().focusWindow(windowId)
    },
    closeWindow: (windowId) => {
      getLive().closeWindow(windowId)
    },
    closeWindowsForApp: (appId) => {
      getLive().closeWindowsForApp(appId)
    },
    minimizeWindow: (windowId) => {
      getLive().minimizeWindow(windowId)
    },
    restoreWindow: (windowId) => {
      getLive().restoreWindow(windowId)
    },
    toggleFullscreen: (windowId) => {
      getLive().toggleFullscreen(windowId)
    },
    toggleMaximize: (windowId) => {
      getLive().toggleMaximize(windowId)
    },
    getCwd: () => '/user',
    getFsMode: () => 'normal',
    getTerminalSessionId: () => 'startup-items',
    noteExternalChangeSet: () => undefined,
    isBusy: () => false,
    confirmClose: async () => true,
  })
}

/** 绑定当前 OS / 生成应用 / 外链应用，供开机执行与设置里「立即运行」共用。 */
export function useStartupItemsShellHost(): InstantShellHost {
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

  const liveRef = useRef<StartupItemsOsLive>({
    windows,
    openApp: (appId, options) => {
      openApp(appId, options)
    },
    openGeneratedApp,
    openExtApp,
    installedApps,
    sessionExtApps,
    focusWindow,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
    restoreWindow,
    toggleFullscreen,
    toggleMaximize,
  })
  liveRef.current = {
    windows,
    openApp: (appId, options) => {
      openApp(appId, options)
    },
    openGeneratedApp,
    openExtApp,
    installedApps,
    sessionExtApps,
    focusWindow,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
    restoreWindow,
    toggleFullscreen,
    toggleMaximize,
  }

  return useMemo(() => createStartupItemsShellHost(() => liveRef.current), [])
}
