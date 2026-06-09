import type { ComponentChild } from 'preact'
import type { BuiltinAppId, GeneratedAppId } from '../../os/types.ts'
import {
  AccountPaneIcon,
  DisplayPaneIcon,
  ExperimentalPaneIcon,
  NewsPaneIcon,
  ResourcesPaneIcon,
  SafariUsagePaneIcon,
  StoragePaneIcon,
} from './settings-pane-icons.tsx'

export type SettingsPaneId =
  | 'usage'
  | 'account'
  | 'display'
  | 'resources'
  | 'safari'
  | 'news'
  | 'experimental'

export type SettingsRoute =
  | { view: 'root' }
  | { view: 'usage' }
  | { view: 'account' }
  | { view: 'display' }
  | { view: 'display-emoji' }
  | { view: 'display-emoji-calibration' }
  | { view: 'resources' }
  | { view: 'resources-3d' }
  | { view: 'resources-3d-detail'; target: import('./resources-3d-detail-view.tsx').Resources3dDetailTarget }
  | { view: 'app-detail'; appId: BuiltinAppId | GeneratedAppId }
  | { view: 'safari-usage' }
  | { view: 'news' }
  | { view: 'experimental' }
  | { view: 'experimental-developer' }

export type SettingsPaneDef = {
  id: SettingsPaneId
  label: string
  Icon: () => ComponentChild
  route: SettingsRoute
}

export const SETTINGS_DEFAULT_ROUTE: SettingsRoute = { view: 'usage' }

export const SETTINGS_PANES: SettingsPaneDef[] = [
  { id: 'usage', label: '存储空间', Icon: StoragePaneIcon, route: SETTINGS_DEFAULT_ROUTE },
  { id: 'account', label: '账户', Icon: AccountPaneIcon, route: { view: 'account' } },
  { id: 'display', label: '显示', Icon: DisplayPaneIcon, route: { view: 'display' } },
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
    label: '实验性特性',
    Icon: ExperimentalPaneIcon,
    route: { view: 'experimental' },
  },
]

export function paneIdForRoute(route: SettingsRoute): SettingsPaneId | undefined {
  switch (route.view) {
    case 'root':
      return undefined
    case 'usage':
    case 'app-detail':
      return 'usage'
    case 'account':
      return 'account'
    case 'display':
    case 'display-emoji':
    case 'display-emoji-calibration':
      return 'display'
    case 'resources':
    case 'resources-3d':
    case 'resources-3d-detail':
      return 'resources'
    case 'safari-usage':
      return 'safari'
    case 'news':
      return 'news'
    case 'experimental':
    case 'experimental-developer':
      return 'experimental'
  }
}

export function isNestedSettingsRoute(route: SettingsRoute): boolean {
  switch (route.view) {
    case 'root':
    case 'usage':
    case 'account':
    case 'display':
    case 'resources':
    case 'safari-usage':
    case 'news':
    case 'experimental':
      return false
    default:
      return true
  }
}
