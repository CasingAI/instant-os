import type { ComponentChild } from 'preact'
import type { BuiltinAppId, GeneratedAppId } from '../../os/types.ts'
import {
  AccountPaneIcon,
  AiUsagePaneIcon,
  DisplayPaneIcon,
  DateTimePaneIcon,
  DeveloperPaneIcon,
  ExternalBridgeConsentPaneIcon,
  NewsPaneIcon,
  ResourcesPaneIcon,
  SafariUsagePaneIcon,
  StoragePaneIcon,
  DockPaneIcon,
  WallpaperPaneIcon,
} from './settings-pane-icons.tsx'

export type SettingsPaneId =
  | 'usage'
  | 'ai-usage'
  | 'account'
  | 'external-bridge-consent'
  | 'display'
  | 'date-time'
  | 'wallpaper'
  | 'dock'
  | 'resources'
  | 'safari'
  | 'news'
  | 'experimental'

export type SettingsRoute =
  | { view: 'root' }
  | { view: 'usage' }
  | { view: 'ai-usage' }
  | { view: 'account' }
  | { view: 'external-bridge-consent' }
  | { view: 'display' }
  | { view: 'date-time' }
  | { view: 'wallpaper' }
  | { view: 'dock' }
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

export type SettingsPaneDef = {
  id: SettingsPaneId
  label: string
  Icon: () => ComponentChild
  route: SettingsRoute
}

/** 窄屏手机式布局：打开时显示一级菜单网格。 */
export const SETTINGS_DEFAULT_ROUTE: SettingsRoute = { view: 'root' }

export { SETTINGS_WIDE_LAYOUT_MIN_WIDTH } from './settings-layout-breakpoints.ts'

export const SETTINGS_PANES: SettingsPaneDef[] = [
  { id: 'usage', label: '存储空间', Icon: StoragePaneIcon, route: { view: 'usage' } },
  { id: 'ai-usage', label: 'AI 用量', Icon: AiUsagePaneIcon, route: { view: 'ai-usage' } },
  { id: 'account', label: '账户', Icon: AccountPaneIcon, route: { view: 'account' } },
  {
    id: 'external-bridge-consent',
    label: '外链 AI 授权',
    Icon: ExternalBridgeConsentPaneIcon,
    route: { view: 'external-bridge-consent' },
  },
  { id: 'display', label: '显示', Icon: DisplayPaneIcon, route: { view: 'display' } },
  { id: 'date-time', label: '日期与时间', Icon: DateTimePaneIcon, route: { view: 'date-time' } },
  { id: 'wallpaper', label: '壁纸', Icon: WallpaperPaneIcon, route: { view: 'wallpaper' } },
  { id: 'dock', label: '程序坞', Icon: DockPaneIcon, route: { view: 'dock' } },
  { id: 'resources', label: '资源', Icon: ResourcesPaneIcon, route: { view: 'resources' } },
  {
    id: 'safari',
    label: '网络浏览器',
    Icon: SafariUsagePaneIcon,
    route: { view: 'safari-usage' },
  },
  { id: 'news', label: '新闻', Icon: NewsPaneIcon, route: { view: 'news' } },
  {
    id: 'experimental',
    label: '开发者选项',
    Icon: DeveloperPaneIcon,
    route: { view: 'experimental' },
  },
]

/** 宽屏分栏布局：右侧需展示内容，打开时默认选中第一个一级项目。 */
export const SETTINGS_WIDE_DEFAULT_ROUTE: SettingsRoute = SETTINGS_PANES[0].route

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
    case 'external-bridge-consent':
      return 'external-bridge-consent'
    case 'display':
    case 'display-emoji':
    case 'display-emoji-calibration':
      return 'display'
    case 'date-time':
      return 'date-time'
    case 'wallpaper':
      return 'wallpaper'
    case 'dock':
      return 'dock'
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
    case 'external-bridge-consent':
    case 'display':
    case 'date-time':
    case 'wallpaper':
    case 'dock':
    case 'resources':
    case 'safari-usage':
    case 'news':
    case 'experimental':
      return false
    default:
      return true
  }
}
