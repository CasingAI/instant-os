import { useMemo } from 'preact/hooks'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { useGeneratedAppHeartbeat } from '../../os/generated-app-heartbeat-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import type { AppId, WindowState } from '../../os/types.ts'
import { isGeneratedAppId } from '../../os/types.ts'
import './task-manager.css'

const APP_ID = 'task-manager' as const

type RunningAppEntry = {
  appId: AppId
  name: string
  windows: WindowState[]
  primaryWindow: WindowState
  status: string
  canEnd: boolean
}

function windowStatusLabel(
  window: WindowState,
  activeWindowId: string | undefined,
  isUnresponsive: boolean,
): string {
  if (isUnresponsive) {
    return '未响应'
  }
  if (window.minimized) {
    return '已最小化'
  }
  if (window.fullscreen) {
    return '全屏'
  }
  if (window.id === activeWindowId) {
    return '正在使用'
  }
  return '后台'
}

function resolveAppStatus(
  windows: WindowState[],
  activeWindowId: string | undefined,
  isUnresponsive: boolean,
): string {
  if (isUnresponsive) {
    return '未响应'
  }
  const active = windows.find((window) => window.id === activeWindowId && !window.minimized)
  if (active) {
    return '正在使用'
  }
  if (windows.every((window) => window.minimized)) {
    return '已最小化'
  }
  if (windows.some((window) => window.fullscreen)) {
    return '全屏'
  }
  return '后台'
}

function resolveAppName(
  appId: AppId,
  windows: WindowState[],
  getInstalledApp: ReturnType<typeof useGeneratedApps>['getInstalledApp'],
): string {
  if (!isGeneratedAppId(appId)) {
    return getAppDefinition(appId)?.name ?? windows[0]?.title ?? '应用'
  }
  return getInstalledApp(appId)?.name ?? windows[0]?.title ?? '微应用'
}

export function TaskManagerApp() {
  const {
    windows,
    activeWindowId,
    closeWindowsForApp,
    focusWindow,
    minimizeWindow,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const { getInstalledApp } = useGeneratedApps()
  const { isAppUnresponsive, isWindowUnresponsive } = useGeneratedAppHeartbeat()
  const definition = getAppDefinition(APP_ID)

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    return [
      {
        label: definition?.name ?? '任务管理器',
        items: [
          ...aboutAppMenuPrefix(`关于 ${definition?.name ?? '任务管理器'}`, () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: `隐藏${definition?.name ?? '任务管理器'}`,
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出${definition?.name ?? '任务管理器'}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, definition?.name, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar(APP_ID, menuBar)

  const runningApps = useMemo((): RunningAppEntry[] => {
    const groups = new Map<AppId, WindowState[]>()

    for (const window of windows) {
      if (window.closing) {
        continue
      }
      const list = groups.get(window.appId) ?? []
      list.push(window)
      groups.set(window.appId, list)
    }

    return [...groups.entries()]
      .map(([appId, appWindows]) => {
        const sortedWindows = [...appWindows].sort((left, right) => right.zIndex - left.zIndex)
        const primaryWindow = sortedWindows[0]
        if (!primaryWindow) {
          return undefined
        }

        return {
          appId,
          name: resolveAppName(appId, sortedWindows, getInstalledApp),
          windows: sortedWindows,
          primaryWindow,
          status: resolveAppStatus(
            sortedWindows,
            activeWindowId,
            isGeneratedAppId(appId) && isAppUnresponsive(appId),
          ),
          canEnd: appId !== APP_ID,
        }
      })
      .filter((entry): entry is RunningAppEntry => entry !== undefined)
      .sort((left, right) => {
        const leftActive = left.primaryWindow.id === activeWindowId && !left.primaryWindow.minimized
        const rightActive = right.primaryWindow.id === activeWindowId && !right.primaryWindow.minimized
        if (leftActive !== rightActive) {
          return leftActive ? -1 : 1
        }
        return left.name.localeCompare(right.name, 'zh-CN')
      })
  }, [activeWindowId, getInstalledApp, isAppUnresponsive, windows])

  const endableApps = runningApps.filter((entry) => entry.canEnd)
  const openWindowCount = windows.filter((window) => !window.closing).length

  return (
    <div class="task-manager">
      <section class="task-manager__section">
        <h2 class="task-manager__section-title">正在运行的应用</h2>
        <p class="task-manager__section-subtitle">
          {runningApps.length === 0
            ? '当前没有打开的应用'
            : `共 ${runningApps.length} 个应用、${openWindowCount} 个窗口`}
        </p>

        {runningApps.length === 0 ? (
          <p class="task-manager__empty">打开任意应用后，会显示在这里。</p>
        ) : (
          <div class="task-manager__list">
            {runningApps.map((entry) => {
              const builtin = !isGeneratedAppId(entry.appId) ? getAppDefinition(entry.appId) : undefined
              const generated = isGeneratedAppId(entry.appId) ? getInstalledApp(entry.appId) : undefined
              const Icon = builtin?.icon
              const isActive =
                entry.primaryWindow.id === activeWindowId && !entry.primaryWindow.minimized
              const isUnresponsive = entry.status === '未响应'
              const singleWindow = entry.windows.length === 1 ? entry.windows[0] : undefined
              const showWindowTitle =
                singleWindow !== undefined && singleWindow.title !== entry.name

              return (
                <div
                  key={entry.appId}
                  class={`task-manager__group${isUnresponsive ? ' task-manager__group--unresponsive' : ''}`}
                >
                  <div
                    class={`task-manager__app-row${isActive ? ' task-manager__app-row--active' : ''}${!entry.canEnd ? ' task-manager__app-row--system' : ''}`}
                  >
                    <button
                      type="button"
                      class="task-manager__app-focus"
                      onClick={() => focusWindow(entry.primaryWindow.id)}
                    >
                      <span class="task-manager__app-icon">
                        {Icon ? (
                          <Icon size={32} />
                        ) : generated ? (
                          <GeneratedAppIcon
                            emoji={generated.iconEmoji}
                            themeColor={generated.themeColor}
                            size={32}
                          />
                        ) : (
                          <span aria-hidden="true">📱</span>
                        )}
                      </span>
                      <span class="task-manager__app-copy">
                        <span class="task-manager__app-name">{entry.name}</span>
                        <span class="task-manager__app-meta">
                          {entry.status}
                          {entry.windows.length > 1 ? ` · ${entry.windows.length} 个窗口` : ''}
                        </span>
                        {showWindowTitle && (
                          <span class="task-manager__window-title">{singleWindow.title}</span>
                        )}
                      </span>
                    </button>

                    {entry.canEnd ? (
                      <button
                        type="button"
                        class="task-manager__end-button"
                        onClick={() => closeWindowsForApp(entry.appId)}
                      >
                        结束
                      </button>
                    ) : (
                      <span class="task-manager__system-badge">系统</span>
                    )}
                  </div>

                  {entry.windows.length > 1 && (
                    <div class="task-manager__window-rows">
                      {entry.windows.map((window) => {
                        const windowUnresponsive = isWindowUnresponsive(window.id)
                        const windowActive = window.id === activeWindowId && !window.minimized

                        return (
                          <button
                            key={window.id}
                            type="button"
                            class={`task-manager__window-row${windowActive ? ' task-manager__window-row--active' : ''}${windowUnresponsive ? ' task-manager__window-row--unresponsive' : ''}`}
                            onClick={() => focusWindow(window.id)}
                          >
                            <span class="task-manager__window-row-title">{window.title}</span>
                            <span class="task-manager__window-row-status">
                              {windowStatusLabel(window, activeWindowId, windowUnresponsive)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {endableApps.length > 0 && (
          <p class="task-manager__footnote">
            点击应用或窗口可切换到前台；「结束」将关闭该应用的全部窗口。
          </p>
        )}
      </section>
    </div>
  )
}
