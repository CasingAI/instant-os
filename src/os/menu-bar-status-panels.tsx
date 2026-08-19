import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { ExtAppIcon } from '../apps/ext/ext-app-icon.tsx'
import { getAppDefinition } from './app-registry.tsx'
import { useGeneratedApps } from './generated-apps-context.tsx'
import { useDevExtApps } from './dev-ext-apps-context.tsx'
import { MenuBarPopover } from './menu-bar-popover.tsx'
import { formatOsDateTime } from './format-os-datetime.ts'
import { isOsUsing24HourTime } from './os-clock.ts'
import type { DeviceBattery } from './use-device-battery.ts'
import type { ProxyServerConnectionState } from './use-proxy-server-connection.ts'
import {
  formatProxyServerBytesPerSec,
} from './proxy-server-metrics.ts'
import { Progress } from '../ui/progress.tsx'
import type { PowProgressState } from './pow-progress-store.ts'
import { useOs } from './os-context.tsx'
import type { AppId, WindowState } from './types.ts'
import { isExtAppId, isGeneratedAppId } from './types.ts'

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

const BATTERY_PANEL_APP_LIMIT = 5

type BatteryStatusPanelProps = {
  battery: DeviceBattery | undefined
  onSelectWindow: (windowId: string) => void
  onOpenTaskManager: () => void
}

export function BatteryStatusPanel({
  battery,
  onSelectWindow,
  onOpenTaskManager,
}: BatteryStatusPanelProps) {
  const { windows, activeWindowId } = useOs()
  const { getInstalledApp } = useGeneratedApps()
  const { getSessionExtApp } = useDevExtApps()

  const levelLabel = battery ? `${battery.levelPercent}%` : '未知'
  const statusLabel = battery
    ? battery.charging
      ? '已连接电源'
      : '使用电池'
    : '无法读取'

  const runningApps = [...windows].sort((a, b) => {
    const aActive = a.id === activeWindowId && !a.minimized
    const bActive = b.id === activeWindowId && !b.minimized
    if (aActive === bActive) {
      return 0
    }
    return aActive ? -1 : 1
  })
  const visibleApps = runningApps.slice(0, BATTERY_PANEL_APP_LIMIT)

  return (
    <MenuBarPopover align="right" label="电池与运行中的应用" flushBottom>
      <p class="menu-bar__popover-heading">电池</p>
      <p class="menu-bar__popover-status">
        {levelLabel} · {statusLabel}
      </p>
      {battery === undefined && (
        <p class="menu-bar__popover-empty menu-bar__popover-empty--compact">
          当前浏览器不支持 Battery API，或尚未授权读取电池信息。
        </p>
      )}
      {battery && battery.levelPercent <= 20 && !battery.charging && (
        <p class="menu-bar__popover-empty menu-bar__popover-empty--compact">电量较低，建议连接电源。</p>
      )}

      {runningApps.length > 0 && (
        <>
          <div class="menu-bar__popover-separator" />
          <p class="menu-bar__popover-heading">正在使用的应用</p>
          {visibleApps.map((window) => {
            const appId = window.appId as AppId
            const isActive = window.id === activeWindowId && !window.minimized
            const status = windowStatusLabel(window, activeWindowId)
            const builtin = !isGeneratedAppId(appId) && !isExtAppId(appId) ? getAppDefinition(appId) : undefined
            const generated = isGeneratedAppId(appId) ? getInstalledApp(appId) : undefined
            const extApp = isExtAppId(appId) ? getSessionExtApp(appId) : undefined
            const name = window.title || builtin?.name || generated?.name || extApp?.manifest.name || '应用'
            const Icon = builtin?.icon

            return (
              <button
                key={window.id}
                type="button"
                class={`menu-bar__popover-app${isActive ? ' menu-bar__popover-app--active' : ''}`}
                onClick={() => onSelectWindow(window.id)}
              >
                <span class="menu-bar__popover-app-icon">
                  {Icon ? (
                    <Icon size={20} />
                  ) : generated ? (
                    <GeneratedAppIcon
                      emoji={generated.iconEmoji}
                      themeColor={generated.themeColor}
                      size={20}
                    />
                  ) : extApp ? (
                    <ExtAppIcon
                      name={extApp.manifest.name}
                      themeColor={extApp.manifest.themeColor}
                      iconUrl={extApp.iconUrl}
                      size={20}
                      devBadge
                    />
                  ) : (
                    <span aria-hidden="true">📱</span>
                  )}
                </span>
                <span class="menu-bar__popover-app-copy">
                  <span class="menu-bar__popover-app-name">{name}</span>
                  <span class="menu-bar__popover-app-status">{status}</span>
                </span>
              </button>
            )
          })}
        </>
      )}

      <button
        type="button"
        class="menu-bar__popover-more"
        onClick={onOpenTaskManager}
      >
        打开性能监视器
      </button>
    </MenuBarPopover>
  )
}

type DateTimePanelProps = {
  now: Date
}

export function DateTimePanel({ now }: DateTimePanelProps) {
  const date = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  const { timeWithSeconds: time } = formatOsDateTime(now, isOsUsing24HourTime())

  return (
    <MenuBarPopover align="center" label="日期与时间">
      <p class="menu-bar__popover-heading">日期与时间</p>
      <div class="menu-bar__popover-datetime">
        <p class="menu-bar__popover-date">{date}</p>
        <p class="menu-bar__popover-time">{time}</p>
      </div>
    </MenuBarPopover>
  )
}

type CloudServiceStatusPanelProps = {
  connection: ProxyServerConnectionState
  powProgress: PowProgressState
  activeNetworkRequests: number
  onOpenCloudServiceSettings: () => void
  onOpenTaskManager: () => void
}

export function CloudServiceStatusPanel({
  connection,
  powProgress,
  activeNetworkRequests,
  onOpenCloudServiceSettings,
  onOpenTaskManager,
}: CloudServiceStatusPanelProps) {
  const { connected, proxyLabel, throughput, recentRequests } = connection
  const powActive = powProgress.active
  const networkActive = activeNetworkRequests > 0
  const hasRecentRequests = connected && recentRequests.length > 0

  return (
    <MenuBarPopover align="right" label="云服务" flushBottom>
      <div class="cloud-panel">
        <p class="menu-bar__popover-heading">云服务</p>

        <div class="cloud-panel__status">
          <span
            class={`cloud-panel__status-dot${connected ? '' : ' cloud-panel__status-dot--off'}`}
            aria-hidden="true"
          />
          <span class="cloud-panel__status-text">
            {connected ? '已连接' : '未连接'}
            {proxyLabel ? ` · ${proxyLabel}` : ''}
          </span>
        </div>

        {connected && (
          <div class="cloud-panel__speed">
            <span>↓ {formatProxyServerBytesPerSec(throughput.downloadBytesPerSec)}</span>
            <span>↑ {formatProxyServerBytesPerSec(throughput.uploadBytesPerSec)}</span>
          </div>
        )}

        {(powActive || networkActive) && (
          <>
            <div class="menu-bar__popover-separator" />
            <p class="menu-bar__popover-heading">进行中</p>
            {networkActive && (
              <div class="cloud-panel__net">
                <span class="cloud-panel__net-spinner" aria-hidden="true" />
                <span>网络请求中…</span>
              </div>
            )}
            {powActive && (
              <div class="cloud-panel__pow">
                <div class="cloud-panel__pow-label">
                  <span class="cloud-panel__pow-name">免费 AI Challenge</span>
                  <span class="cloud-panel__pow-count">
                    <span class="cloud-panel__pow-tried">{Math.round(powProgress.tried).toLocaleString()}</span>
                    <span class="cloud-panel__pow-total">共 {powProgress.total.toLocaleString()} 次</span>
                  </span>
                </div>
                <Progress
                  percent={powProgress.percent}
                  status="active"
                  size="small"
                  showInfo={false}
                />
              </div>
            )}
          </>
        )}

        {hasRecentRequests && (
          <>
            <div class="menu-bar__popover-separator" />
            <p class="menu-bar__popover-heading">最近请求</p>
            <div class="cloud-panel__requests">
              {recentRequests.map((request) => (
                <div key={request.id} class="cloud-panel__request">
                  <span class="cloud-panel__request-host" title={request.host}>
                    {request.host}
                  </span>
                  <span class="cloud-panel__request-meta">
                    {request.status ?? '失败'} · {request.durationMs} ms
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div class="cloud-panel__actions">
          <button type="button" class="cloud-panel__action" onClick={onOpenCloudServiceSettings}>
            云服务设置…
          </button>
          <button type="button" class="cloud-panel__action" onClick={onOpenTaskManager}>
            打开性能监视器
          </button>
        </div>
      </div>
    </MenuBarPopover>
  )
}
