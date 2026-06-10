import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { getAppDefinition } from './app-registry.tsx'
import { useGeneratedApps } from './generated-apps-context.tsx'
import { MenuBarPopover } from './menu-bar-popover.tsx'
import type { DeviceBattery } from './use-device-battery.ts'
import { useOs } from './os-context.tsx'
import type { AppId, WindowState } from './types.ts'
import { isGeneratedAppId } from './types.ts'

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

type BatteryStatusPanelProps = {
  battery: DeviceBattery | undefined
  onSelectWindow: (windowId: string) => void
}

export function BatteryStatusPanel({ battery, onSelectWindow }: BatteryStatusPanelProps) {
  const { windows, activeWindowId } = useOs()
  const { getInstalledApp } = useGeneratedApps()

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

  return (
    <MenuBarPopover align="right" label="电池与运行中的应用">
      <p class="menu-bar__popover-heading">电池</p>
      <div class="menu-bar__popover-row">
        <span class="menu-bar__popover-row-label">电量</span>
        <span class="menu-bar__popover-row-value">{levelLabel}</span>
      </div>
      <div class="menu-bar__popover-row">
        <span class="menu-bar__popover-row-label">状态</span>
        <span class="menu-bar__popover-row-value">{statusLabel}</span>
      </div>
      {battery === undefined && (
        <p class="menu-bar__popover-empty menu-bar__popover-empty--compact">
          当前浏览器不支持 Battery API，或尚未授权读取电池信息。
        </p>
      )}
      {battery && battery.levelPercent <= 20 && !battery.charging && (
        <p class="menu-bar__popover-empty menu-bar__popover-empty--compact">电量较低，建议连接电源。</p>
      )}

      <div class="menu-bar__popover-separator" />
      <p class="menu-bar__popover-heading">使用能耗的应用</p>
      {runningApps.length === 0 ? (
        <p class="menu-bar__popover-empty">没有应用在使用显著能耗。</p>
      ) : (
        runningApps.map((window) => {
          const appId = window.appId as AppId
          const isActive = window.id === activeWindowId && !window.minimized
          const status = windowStatusLabel(window, activeWindowId)
          const builtin = !isGeneratedAppId(appId) ? getAppDefinition(appId) : undefined
          const generated = isGeneratedAppId(appId) ? getInstalledApp(appId) : undefined
          const name = window.title || builtin?.name || generated?.name || '应用'
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
                  <Icon size={24} />
                ) : generated ? (
                  <GeneratedAppIcon
                    emoji={generated.iconEmoji}
                    themeColor={generated.themeColor}
                    size={24}
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
        })
      )}
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
  const time = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

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
