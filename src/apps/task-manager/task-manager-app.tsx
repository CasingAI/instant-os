import { useMemo } from 'preact/hooks'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
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
}

function windowStatusLabel(window: WindowState, activeWindowId: string | undefined): string {
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

function resolveAppStatus(windows: WindowState[], activeWindowId: string | undefined): string {
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
          status: resolveAppStatus(sortedWindows, activeWindowId),
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
  }, [activeWindowId, getInstalledApp, windows])

  return (
    <div class="task-manager">
      <header class="task-manager__header">
        <h1 class="task-manager__title">正在运行的应用</h1>
        <p class="task-manager__subtitle">
          {runningApps.length === 0
            ? '当前没有打开的应用'
            : `共 ${runningApps.length} 个应用、${windows.filter((window) => !window.closing).length} 个窗口`}
        </p>
      </header>

      {runningApps.length === 0 ? (
        <p class="task-manager__empty">打开任意应用后，会显示在这里。</p>
      ) : (
        <div class="task-manager__table-wrap">
          <table class="task-manager__table">
            <thead>
              <tr>
                <th scope="col" class="task-manager__col task-manager__col--app">
                  应用
                </th>
                <th scope="col" class="task-manager__col task-manager__col--status">
                  状态
                </th>
                <th scope="col" class="task-manager__col task-manager__col--windows">
                  窗口
                </th>
                <th scope="col" class="task-manager__col task-manager__col--action">
                  <span class="task-manager__sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runningApps.map((entry) => {
                const builtin = !isGeneratedAppId(entry.appId) ? getAppDefinition(entry.appId) : undefined
                const generated = isGeneratedAppId(entry.appId) ? getInstalledApp(entry.appId) : undefined
                const Icon = builtin?.icon
                const isActive =
                  entry.primaryWindow.id === activeWindowId && !entry.primaryWindow.minimized

                return (
                  <tr
                    key={entry.appId}
                    class={`task-manager__row${isActive ? ' task-manager__row--active' : ''}`}
                  >
                    <td class="task-manager__cell task-manager__cell--app">
                      <button
                        type="button"
                        class="task-manager__app-button"
                        onClick={() => focusWindow(entry.primaryWindow.id)}
                      >
                        <span class="task-manager__app-icon">
                          {Icon ? (
                            <Icon size={28} />
                          ) : generated ? (
                            <GeneratedAppIcon
                              emoji={generated.iconEmoji}
                              themeColor={generated.themeColor}
                              size={28}
                            />
                          ) : (
                            <span aria-hidden="true">📱</span>
                          )}
                        </span>
                        <span class="task-manager__app-copy">
                          <span class="task-manager__app-name">{entry.name}</span>
                          {entry.windows.length === 1 && entry.windows[0]?.title !== entry.name && (
                            <span class="task-manager__window-title">{entry.windows[0]?.title}</span>
                          )}
                        </span>
                      </button>
                    </td>
                    <td class="task-manager__cell task-manager__cell--status">
                      <span class={`task-manager__status${isActive ? ' task-manager__status--active' : ''}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td class="task-manager__cell task-manager__cell--windows">
                      {entry.windows.length === 1 ? (
                        <span class="task-manager__window-count">1</span>
                      ) : (
                        <ul class="task-manager__window-list">
                          {entry.windows.map((window) => (
                            <li key={window.id}>
                              <button
                                type="button"
                                class="task-manager__window-button"
                                onClick={() => focusWindow(window.id)}
                              >
                                <span class="task-manager__window-button-title">{window.title}</span>
                                <span class="task-manager__window-button-status">
                                  {windowStatusLabel(window, activeWindowId)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td class="task-manager__cell task-manager__cell--action">
                      <button
                        type="button"
                        class="task-manager__end-button"
                        onClick={() => closeWindowsForApp(entry.appId)}
                      >
                        结束
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {runningApps.some((entry) => entry.windows.length > 1) && (
        <p class="task-manager__hint">多窗口应用可点击窗口标题切换焦点；「结束」将关闭该应用的全部窗口。</p>
      )}
    </div>
  )
}
