import type { GeneratedAppRecord } from '../../apps/appstore/types.ts'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import type { ExtAppRecord } from '../../os/ext-app-types.ts'
import type { AppId, WindowState } from '../../os/types.ts'
import { isExtAppId, isGeneratedAppId } from '../../os/types.ts'
import type {
  InstantShellAppInfo,
  InstantShellHost,
  InstantShellOpenAppOptions,
  InstantShellWindowInfo,
} from './instant-shell-types.ts'

export type TerminalInstantShellHostDeps = {
  getWindows: () => WindowState[]
  openApp: (appId: AppId, options?: InstantShellOpenAppOptions) => void
  openGeneratedApp: (appId: `gen:${string}`, title: string) => void
  openExtApp: (appId: `ext:${string}`, title: string) => void
  getInstalledGeneratedApps: () => GeneratedAppRecord[]
  getSessionExtApps: () => ExtAppRecord[]
  focusWindow: (windowId: string) => void
  closeWindow: (windowId: string) => void
  closeWindowsForApp: (appId: AppId) => void
  minimizeWindow: (windowId: string) => void
  restoreWindow: (windowId: string) => void
  toggleFullscreen: (windowId: string) => void
  toggleMaximize: (windowId: string) => void
  getCwd: () => string
  isBusy: () => boolean
  confirmClose: (message: string) => Promise<boolean>
}

function toWindowInfo(window: WindowState): InstantShellWindowInfo {
  return {
    windowId: window.id,
    appId: window.appId,
    title: window.title,
    minimized: window.minimized,
    maximized: window.maximized,
    fullscreen: window.fullscreen,
    zIndex: window.zIndex,
  }
}

function pickTopWindow(windows: WindowState[], appId: string): WindowState | undefined {
  const live = windows.filter((window) => window.appId === appId && !window.closing)
  if (live.length === 0) {
    return undefined
  }
  const visible = live.filter((window) => !window.minimized)
  const pool = visible.length > 0 ? visible : live
  return pool.reduce((best, window) => (window.zIndex >= best.zIndex ? window : best))
}

/** 组装终端用的 InstantShellHost（仍不调用 hooks）。 */
export function createTerminalInstantShellHost(
  deps: TerminalInstantShellHostDeps,
): InstantShellHost {
  const listApps = (): InstantShellAppInfo[] => {
    const builtins: InstantShellAppInfo[] = APP_REGISTRY.map((app) => ({
      id: app.id,
      name: app.name,
      kind: 'builtin',
    }))
    const generated: InstantShellAppInfo[] = deps.getInstalledGeneratedApps().map((app) => ({
      id: app.id,
      name: app.name,
      kind: 'generated',
    }))
    const ext: InstantShellAppInfo[] = deps.getSessionExtApps().map((app) => ({
      id: app.id,
      name: app.manifest.name,
      kind: 'ext',
    }))
    return [...builtins, ...generated, ...ext]
  }

  return {
    openApp: (appId, options) => {
      deps.openApp(appId as AppId, options)
    },
    openGeneratedApp: (appId, title) => {
      if (!isGeneratedAppId(appId)) {
        throw new Error(`无效的生成应用 id: ${appId}`)
      }
      deps.openGeneratedApp(appId, title)
    },
    openExtApp: (appId, title) => {
      if (!isExtAppId(appId)) {
        throw new Error(`无效的外链应用 id: ${appId}`)
      }
      deps.openExtApp(appId, title)
    },
    listApps,
    listWindows: () =>
      deps
        .getWindows()
        .filter((window) => !window.closing)
        .map(toWindowInfo),
    resolveTarget: (target) => {
      const trimmed = target.trim()
      if (!trimmed) {
        throw new Error('target 不能为空')
      }
      const windows = deps.getWindows().filter((window) => !window.closing)
      const byWindowId = windows.find((window) => window.id === trimmed)
      if (byWindowId) {
        return {
          type: 'window',
          windowId: byWindowId.id,
          appId: byWindowId.appId,
        }
      }

      const top = pickTopWindow(windows, trimmed)
      return {
        type: 'app',
        appId: trimmed,
        windowId: top?.id,
      }
    },
    focusWindow: deps.focusWindow,
    closeWindow: deps.closeWindow,
    closeWindowsForApp: (appId) => {
      deps.closeWindowsForApp(appId as AppId)
    },
    minimizeWindow: deps.minimizeWindow,
    restoreWindow: deps.restoreWindow,
    toggleFullscreen: deps.toggleFullscreen,
    toggleMaximize: deps.toggleMaximize,
    getCwd: deps.getCwd,
    isBusy: deps.isBusy,
    confirmClose: deps.confirmClose,
  }
}
