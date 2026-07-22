import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { ExtAppIcon } from '../ext/ext-app-icon.tsx'
import {
  AI_EVENT_LOG_CHANGED_EVENT,
  formatTokensPerSecond,
  getLiveAiEventLogCount,
  listLiveAiEventLogs,
} from '../../ai/ai-event-log.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { useDevExtApps } from '../../os/dev-ext-apps-context.tsx'
import { useGeneratedAppHeartbeat } from '../../os/generated-app-heartbeat-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import type { AppId, WindowState } from '../../os/types.ts'
import { isExtAppId, isGeneratedAppId } from '../../os/types.ts'
import { TaskManagerPerformancePanel } from './task-manager-performance-panel.tsx'
import {
  formatSampleIntervalLabel,
  SPEED_SAMPLE_INTERVALS,
  type SpeedSampleIntervalSec,
} from './task-manager-speed-series.ts'
import { useTaskManagerSpeedSeries } from './task-manager-use-speed-series.ts'
import { useTaskManagerSystemMetrics } from './task-manager-use-system-metrics.ts'
import { useTaskManagerProxyServerMetrics } from './task-manager-use-proxy-server-metrics.ts'
import { useTaskManagerFilesIoMetrics } from './task-manager-use-files-io-metrics.ts'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import './task-manager.css'

const APP_ID = 'task-manager' as const
const LIVE_ACTIVITY_TICK_MS = 500

type TaskManagerTab = 'programs' | 'performance'

type LiveAppActivity = {
  tokensPerSecond: number
  behaviorLabel: string
  sessionCount: number
  usageEstimated: boolean
}

type RunningAppEntry = {
  appId: AppId
  name: string
  windows: WindowState[]
  primaryWindow: WindowState
  status: string
  canEnd: boolean
  liveActivity: LiveAppActivity | undefined
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
  getSessionExtApp: ReturnType<typeof useDevExtApps>['getSessionExtApp'],
): string {
  if (isExtAppId(appId)) {
    return getSessionExtApp(appId)?.manifest.name ?? windows[0]?.title ?? '外链应用'
  }
  if (isGeneratedAppId(appId)) {
    return getInstalledApp(appId)?.name ?? windows[0]?.title ?? '微应用'
  }
  return getAppDefinition(appId)?.name ?? windows[0]?.title ?? '应用'
}

function collectLiveAppActivity(): Map<string, LiveAppActivity> {
  const byActor = new Map<string, LiveAppActivity>()

  for (const record of listLiveAiEventLogs()) {
    const existing = byActor.get(record.actor)
    const rate = record.completionTokensPerSecond ?? 0
    const usageEstimated = record.usageEstimated === true
    if (!existing) {
      byActor.set(record.actor, {
        tokensPerSecond: rate,
        behaviorLabel: record.behaviorLabel || record.behavior,
        sessionCount: 1,
        usageEstimated,
      })
      continue
    }
    existing.tokensPerSecond += rate
    existing.sessionCount += 1
    existing.usageEstimated = existing.usageEstimated || usageEstimated
  }

  return byActor
}

export function TaskManagerApp() {
  const {
    windows,
    activeWindowId,
    closeWindowsForApp,
    minimizeWindow,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const { getInstalledApp } = useGeneratedApps()
  const { getSessionExtApp } = useDevExtApps()
  const { isAppUnresponsive } = useGeneratedAppHeartbeat()
  const definition = getAppDefinition(APP_ID)
  const [tab, setTab] = useState<TaskManagerTab>('programs')
  const [sampleIntervalSec, setSampleIntervalSec] = useState<SpeedSampleIntervalSec>(1)
  const [liveByActor, setLiveByActor] = useState<Map<string, LiveAppActivity>>(() => new Map())
  const speedSeries = useTaskManagerSpeedSeries(sampleIntervalSec)
  const systemMetrics = useTaskManagerSystemMetrics(sampleIntervalSec)
  const proxyServerMetrics = useTaskManagerProxyServerMetrics(sampleIntervalSec)
  const filesIoMetrics = useTaskManagerFilesIoMetrics(sampleIntervalSec)

  const refreshLiveActivity = useCallback(() => {
    setLiveByActor(collectLiveAppActivity())
  }, [])

  useEffect(() => {
    refreshLiveActivity()
    const onChanged = () => {
      refreshLiveActivity()
    }
    window.addEventListener(AI_EVENT_LOG_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(AI_EVENT_LOG_CHANGED_EVENT, onChanged)
  }, [refreshLiveActivity])

  useEffect(() => {
    if (tab !== 'programs') {
      return
    }
    if (liveByActor.size === 0 && getLiveAiEventLogCount() === 0) {
      return
    }
    const timer = window.setInterval(() => {
      refreshLiveActivity()
    }, LIVE_ACTIVITY_TICK_MS)
    return () => window.clearInterval(timer)
  }, [liveByActor.size, refreshLiveActivity, tab])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    return [
      {
        label: definition?.name ?? '性能监视器',
        items: [
          ...aboutAppMenuPrefix(`关于 ${definition?.name ?? '性能监视器'}`, () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: `隐藏${definition?.name ?? '性能监视器'}`,
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出${definition?.name ?? '性能监视器'}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '视图',
        items: [
          {
            type: 'action',
            label: '程序',
            onClick: () => setTab('programs'),
          },
          {
            type: 'action',
            label: '性能',
            onClick: () => setTab('performance'),
          },
          { type: 'separator' },
          {
            type: 'submenu',
            label: `采样间隔：${formatSampleIntervalLabel(sampleIntervalSec)}`,
            items: SPEED_SAMPLE_INTERVALS.map((seconds) => ({
              type: 'action' as const,
              label: `${sampleIntervalSec === seconds ? '✓ ' : ''}${formatSampleIntervalLabel(seconds)}`,
              onClick: () => {
                setSampleIntervalSec(seconds)
              },
            })),
          },
        ],
      },
    ]
  }, [
    closeWindowsForApp,
    definition?.name,
    minimizeWindow,
    sampleIntervalSec,
    showBuiltinAbout,
    windows,
  ])

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
          name: resolveAppName(appId, sortedWindows, getInstalledApp, getSessionExtApp),
          windows: sortedWindows,
          primaryWindow,
          status: resolveAppStatus(
            sortedWindows,
            activeWindowId,
            isGeneratedAppId(appId) && isAppUnresponsive(appId),
          ),
          canEnd: appId !== APP_ID,
          liveActivity: liveByActor.get(appId),
        }
      })
      .filter((entry): entry is RunningAppEntry => entry !== undefined)
      .sort((left, right) => {
        const leftGenerating = left.liveActivity !== undefined
        const rightGenerating = right.liveActivity !== undefined
        if (leftGenerating !== rightGenerating) {
          return leftGenerating ? -1 : 1
        }
        const leftActive = left.primaryWindow.id === activeWindowId && !left.primaryWindow.minimized
        const rightActive = right.primaryWindow.id === activeWindowId && !right.primaryWindow.minimized
        if (leftActive !== rightActive) {
          return leftActive ? -1 : 1
        }
        return left.name.localeCompare(right.name, 'zh-CN')
      })
  }, [activeWindowId, getInstalledApp, getSessionExtApp, isAppUnresponsive, liveByActor, windows])

  const endableApps = runningApps.filter((entry) => entry.canEnd)
  const openWindowCount = windows.filter((window) => !window.closing).length

  return (
    <div class="task-manager">
      <SegmentedControl
        value={tab}
        ariaLabel="性能监视器"
        className="task-manager__section-tabs"
        items={[
          { id: 'programs', label: '程序' },
          { id: 'performance', label: '性能' },
        ]}
        onChange={setTab}
      />

      <div class="task-manager__tab-body">
        <section
          class="task-manager__section task-manager__tab-panel"
          hidden={tab !== 'programs'}
          aria-hidden={tab !== 'programs'}
        >
          <h2 class="task-manager__section-title">正在运行的应用</h2>
          <p class="task-manager__section-subtitle">
            {runningApps.length === 0
              ? '当前没有打开的应用'
              : `共 ${runningApps.length} 个应用、${openWindowCount} 个窗口`}
          </p>

          {runningApps.length === 0 ? (
            <p class="task-manager__empty">打开任意应用后，会显示在这里。</p>
          ) : (
            <div class="task-manager__table-wrap">
              <table class="task-manager__table">
                <thead>
                  <tr>
                    <th class="task-manager__th task-manager__th--name">名称</th>
                    <th class="task-manager__th task-manager__th--status">状态</th>
                    <th class="task-manager__th task-manager__th--ai">AI 速度</th>
                    <th class="task-manager__th task-manager__th--windows">窗口</th>
                    <th class="task-manager__th task-manager__th--action">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {runningApps.map((entry) => {
                    const builtin = !isGeneratedAppId(entry.appId) && !isExtAppId(entry.appId)
                      ? getAppDefinition(entry.appId)
                      : undefined
                    const generated = isGeneratedAppId(entry.appId)
                      ? getInstalledApp(entry.appId)
                      : undefined
                    const extApp = isExtAppId(entry.appId)
                      ? getSessionExtApp(entry.appId)
                      : undefined
                    const Icon = builtin?.icon
                    const isUnresponsive = entry.status === '未响应'
                    const aiSpeed = entry.liveActivity
                      ? `${entry.liveActivity.usageEstimated ? '~' : ''}${formatTokensPerSecond(entry.liveActivity.tokensPerSecond)}`
                      : '—'

                    return (
                      <tr
                        key={entry.appId}
                        class={`task-manager__tr${isUnresponsive ? ' task-manager__tr--unresponsive' : ''}`}
                      >
                        <td class="task-manager__td task-manager__td--name">
                          <span class="task-manager__name-cell">
                            <span class="task-manager__app-icon">
                              {Icon ? (
                                <Icon size={28} />
                              ) : generated ? (
                                <GeneratedAppIcon
                                  emoji={generated.iconEmoji}
                                  themeColor={generated.themeColor}
                                  size={28}
                                />
                              ) : extApp ? (
                                <ExtAppIcon
                                  name={extApp.manifest.name}
                                  themeColor={extApp.manifest.themeColor}
                                  iconUrl={extApp.iconUrl}
                                  size={28}
                                  devBadge
                                />
                              ) : (
                                <span aria-hidden="true">📱</span>
                              )}
                            </span>
                            <span class="task-manager__name-text">{entry.name}</span>
                          </span>
                        </td>
                        <td class="task-manager__td task-manager__td--status">{entry.status}</td>
                        <td
                          class={`task-manager__td task-manager__td--ai${entry.liveActivity ? ' task-manager__td--ai-live' : ''}`}
                        >
                          {aiSpeed}
                        </td>
                        <td class="task-manager__td task-manager__td--windows">
                          {entry.windows.length}
                        </td>
                        <td class="task-manager__td task-manager__td--action">
                          {entry.canEnd ? (
                            <button
                              type="button"
                              class="task-manager__end-button"
                              onClick={() => {
                                closeWindowsForApp(entry.appId)
                              }}
                            >
                              结束
                            </button>
                          ) : (
                            <span class="task-manager__system-badge">系统</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {endableApps.length > 0 && (
            <p class="task-manager__footnote">
              「AI 速度」只在正在生成时显示数值；点「结束」会关闭该应用的全部窗口。
            </p>
          )}
        </section>

        <div
          class="task-manager__tab-panel"
          hidden={tab !== 'performance'}
          aria-hidden={tab !== 'performance'}
        >
          <TaskManagerPerformancePanel
            sampleIntervalSec={sampleIntervalSec}
            series={speedSeries}
            fpsSeries={systemMetrics.fpsSeries}
            memorySeries={systemMetrics.memorySeries}
            latestFps={systemMetrics.latestFps}
            memory={systemMetrics.memory}
            memorySupported={systemMetrics.memorySupported}
            proxyDownloadSeries={proxyServerMetrics.downloadSeries}
            proxyUploadSeries={proxyServerMetrics.uploadSeries}
            latestProxyDownload={proxyServerMetrics.latestDownloadBytesPerSec}
            latestProxyUpload={proxyServerMetrics.latestUploadBytesPerSec}
            proxyServerConnected={proxyServerMetrics.proxyServerConnected}
            proxyRecentRequests={proxyServerMetrics.recentRequests}
            filesIoContainers={filesIoMetrics.containers}
            filesIoRecentOperations={filesIoMetrics.recentOperations}
          />
        </div>
      </div>
    </div>
  )
}
