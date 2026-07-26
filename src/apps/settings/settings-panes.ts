import type { ComponentChild } from 'preact'
import type { BackgroundRefreshTaskId } from '../../os/background-refresh-settings-storage.ts'
import type { ExperimentalSettings } from '../../os/experimental-settings-storage.ts'
import type { BuiltinAppId, GeneratedAppId } from '../../os/types.ts'
import {
  AccountPaneIcon,
  AiUsagePaneIcon,
  BackgroundRefreshPaneIcon,
  DisplayPaneIcon,
  DateTimePaneIcon,
  DeveloperPaneIcon,
  ExternalBridgeConsentPaneIcon,
  NewsPaneIcon,
  ProxyServerPaneIcon,
  NotificationCenterPaneIcon,
  ResourcesPaneIcon,
  SafariUsagePaneIcon,
  SpeechPaneIcon,
  StoragePaneIcon,
  SystemEnvPaneIcon,
  StartupItemsPaneIcon,
  NpmPaneIcon,
  DockPaneIcon,
  WallpaperPaneIcon,
} from './settings-pane-icons.tsx'

export type SettingsPaneId =
  | 'usage'
  | 'ai-usage'
  | 'account'
  | 'speech'
  | 'external-bridge-consent'
  | 'display'
  | 'date-time'
  | 'notification-center'
  | 'wallpaper'
  | 'dock'
  | 'proxy-server'
  | 'background-refresh'
  | 'npm'
  | 'system-env'
  | 'startup-items'
  | 'resources'
  | 'safari'
  | 'news'
  | 'experimental'

export type SettingsRoute =
  | { view: 'root' }
  | { view: 'usage' }
  | { view: 'ai-usage' }
  | { view: 'account' }
  | { view: 'speech' }
  | { view: 'external-bridge-consent' }
  | { view: 'display' }
  | { view: 'date-time' }
  | { view: 'notification-center' }
  | { view: 'wallpaper' }
  | { view: 'dock' }
  | { view: 'proxy-server' }
  | { view: 'background-refresh' }
  | { view: 'background-refresh-task'; taskId: BackgroundRefreshTaskId }
  | { view: 'npm' }
  | { view: 'system-env' }
  | { view: 'startup-items' }
  | { view: 'display-emoji' }
  | { view: 'display-emoji-calibration' }
  | { view: 'resources' }
  | { view: 'resources-3d' }
  | { view: 'resources-3d-detail'; target: import('./resources-3d-detail-view.tsx').Resources3dDetailTarget }
  | { view: 'app-detail'; appId: BuiltinAppId | GeneratedAppId; from?: 'usage' | 'apps-storage' }
  | { view: 'apps-storage' }
  | { view: 'other-storage' }
  | { view: 'event-log-storage' }
  | { view: 'safari-usage' }
  | { view: 'news' }
  | { view: 'experimental' }

export type SettingsPaneGroupId = 'account' | 'storage' | 'appearance' | 'system' | 'network' | 'developer'

export type SettingsPaneGroupDef = {
  id: SettingsPaneGroupId
  label: string
}

/** 一级菜单的分组顺序与标题。 */
export const SETTINGS_PANE_GROUPS: SettingsPaneGroupDef[] = [
  { id: 'storage', label: '存储' },
  { id: 'appearance', label: '外观' },
  { id: 'system', label: '系统' },
  { id: 'account', label: '账户' },
  { id: 'network', label: '网络与内容' },
  { id: 'developer', label: '开发者' },
]

export type SettingsPaneDef = {
  id: SettingsPaneId
  label: string
  Icon: () => ComponentChild
  route: SettingsRoute
  group: SettingsPaneGroupId
}

/** 窄屏手机式布局：打开时显示一级菜单网格。 */
export const SETTINGS_DEFAULT_ROUTE: SettingsRoute = { view: 'root' }

export { SETTINGS_WIDE_LAYOUT_MIN_WIDTH } from './settings-layout-breakpoints.ts'

export const SETTINGS_PANES: SettingsPaneDef[] = [
  // 存储
  { id: 'usage', label: '存储空间', Icon: StoragePaneIcon, route: { view: 'usage' }, group: 'storage' },
  { id: 'ai-usage', label: 'AI 用量', Icon: AiUsagePaneIcon, route: { view: 'ai-usage' }, group: 'storage' },
  // 外观
  { id: 'display', label: '显示', Icon: DisplayPaneIcon, route: { view: 'display' }, group: 'appearance' },
  { id: 'wallpaper', label: '壁纸', Icon: WallpaperPaneIcon, route: { view: 'wallpaper' }, group: 'appearance' },
  { id: 'dock', label: '程序坞', Icon: DockPaneIcon, route: { view: 'dock' }, group: 'appearance' },
  // 系统
  { id: 'date-time', label: '日期与时间', Icon: DateTimePaneIcon, route: { view: 'date-time' }, group: 'system' },
  {
    id: 'notification-center',
    label: '通知中心',
    Icon: NotificationCenterPaneIcon,
    route: { view: 'notification-center' },
    group: 'system',
  },
  {
    id: 'startup-items',
    label: '启动项',
    Icon: StartupItemsPaneIcon,
    route: { view: 'startup-items' },
    group: 'system',
  },
  { id: 'resources', label: '资源', Icon: ResourcesPaneIcon, route: { view: 'resources' }, group: 'system' },
  // 账户
  { id: 'account', label: '账户', Icon: AccountPaneIcon, route: { view: 'account' }, group: 'account' },
  // 网络与内容
  {
    id: 'safari',
    label: '网络浏览器',
    Icon: SafariUsagePaneIcon,
    route: { view: 'safari-usage' },
    group: 'network',
  },
  { id: 'news', label: '新闻', Icon: NewsPaneIcon, route: { view: 'news' }, group: 'network' },
  { id: 'proxy-server', label: '代理服务器', Icon: ProxyServerPaneIcon, route: { view: 'proxy-server' }, group: 'network' },
  {
    id: 'background-refresh',
    label: '背景刷新',
    Icon: BackgroundRefreshPaneIcon,
    route: { view: 'background-refresh' },
    group: 'network',
  },
  // 开发者
  { id: 'npm', label: 'NPM', Icon: NpmPaneIcon, route: { view: 'npm' }, group: 'developer' },
  { id: 'system-env', label: '环境变量', Icon: SystemEnvPaneIcon, route: { view: 'system-env' }, group: 'developer' },
  {
    id: 'experimental',
    label: '开发者选项',
    Icon: DeveloperPaneIcon,
    route: { view: 'experimental' },
    group: 'developer',
  },
  { id: 'speech', label: '语音', Icon: SpeechPaneIcon, route: { view: 'speech' }, group: 'developer' },
  {
    // 【实验性 · 未完成】外链应用平台（Bridge）；仅在 experimental.externalBridge 开启时可见
    id: 'external-bridge-consent',
    label: '外链 AI 授权',
    Icon: ExternalBridgeConsentPaneIcon,
    route: { view: 'external-bridge-consent' },
    group: 'developer',
  },
]

/** 按开发者选项过滤一级设置入口（语音 / 外链 AI 授权依赖实验开关）。 */
export function getVisibleSettingsPanes(
  experimental: ExperimentalSettings,
): SettingsPaneDef[] {
  return SETTINGS_PANES.filter((pane) => {
    if (pane.id === 'speech') return experimental.speechApp === true
    if (pane.id === 'external-bridge-consent') return experimental.externalBridge === true
    return true
  })
}

export type SettingsPaneGroup = {
  group: SettingsPaneGroupDef
  panes: SettingsPaneDef[]
}

/** 按分组返回可见的一级设置入口；空分组会被自动过滤掉。 */
export function getVisibleSettingsPaneGroups(
  experimental: ExperimentalSettings,
): SettingsPaneGroup[] {
  const visible = getVisibleSettingsPanes(experimental)
  return SETTINGS_PANE_GROUPS.map((group) => ({
    group,
    panes: visible.filter((pane) => pane.group === group.id),
  })).filter((entry) => entry.panes.length > 0)
}

/** 当前路由对应的一级入口是否应对用户可见。 */
export function isSettingsRouteVisible(
  route: SettingsRoute,
  experimental: ExperimentalSettings,
): boolean {
  const paneId = paneIdForRoute(route)
  if (paneId === undefined) return true
  if (paneId === 'speech') return experimental.speechApp === true
  if (paneId === 'external-bridge-consent') return experimental.externalBridge === true
  return true
}

/** 宽屏分栏布局：右侧需展示内容，打开时默认选中「存储空间」。 */
export const SETTINGS_WIDE_DEFAULT_ROUTE: SettingsRoute = { view: 'usage' }

export function paneIdForRoute(route: SettingsRoute): SettingsPaneId | undefined {
  switch (route.view) {
    case 'root':
      return undefined
    case 'usage':
    case 'app-detail':
    case 'apps-storage':
    case 'other-storage':
    case 'event-log-storage':
      return 'usage'
    case 'ai-usage':
      return 'ai-usage'
    case 'account':
      return 'account'
    case 'speech':
      return 'speech'
    case 'external-bridge-consent':
      return 'external-bridge-consent'
    case 'display':
    case 'display-emoji':
    case 'display-emoji-calibration':
      return 'display'
    case 'date-time':
      return 'date-time'
    case 'notification-center':
      return 'notification-center'
    case 'wallpaper':
      return 'wallpaper'
    case 'dock':
      return 'dock'
    case 'proxy-server':
      return 'proxy-server'
    case 'background-refresh':
    case 'background-refresh-task':
      return 'background-refresh'
    case 'npm':
      return 'npm'
    case 'system-env':
      return 'system-env'
    case 'startup-items':
      return 'startup-items'
    case 'resources':
    case 'resources-3d':
    case 'resources-3d-detail':
      return 'resources'
    case 'safari-usage':
      return 'safari'
    case 'news':
      return 'news'
    case 'experimental':
      return 'experimental'
  }
}

export function isNestedSettingsRoute(route: SettingsRoute): boolean {
  switch (route.view) {
    case 'root':
    case 'usage':
    case 'ai-usage':
    case 'account':
    case 'speech':
    case 'external-bridge-consent':
    case 'display':
    case 'date-time':
    case 'notification-center':
    case 'wallpaper':
    case 'dock':
    case 'proxy-server':
    case 'background-refresh':
    case 'npm':
    case 'system-env':
    case 'startup-items':
    case 'resources':
    case 'safari-usage':
    case 'news':
    case 'experimental':
      return false
    default:
      return true
  }
}
