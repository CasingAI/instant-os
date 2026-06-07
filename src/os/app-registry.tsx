import type { ComponentType } from 'preact'
import { useMemo } from 'preact/hooks'
import { AppStoreApp } from '../apps/appstore/appstore-app.tsx'
import { BrowserApp } from '../apps/browser/browser-app.tsx'
import { MailApp } from '../apps/mail/mail-app.tsx'
import { SettingsApp } from '../apps/settings/settings-app.tsx'
import { useAboutApp } from './about-app-context.tsx'
import { aboutAppMenuPrefix } from './about-app-menu.ts'
import { useAppMenuBar } from './menu-bar-context.tsx'
import type { MenuDefinition } from './menu-bar-types.ts'
import { useOs } from './os-context.tsx'
import { BrowserIcon, AppStoreIcon, MailIcon, PhotosIcon, SettingsIcon } from '../icons/app-icons.tsx'
import { BUILTIN_APP_ABOUT } from './builtin-app-about.ts'
import type { AppDefinition, BuiltinAppId } from './types.ts'

function withAbout(app: AppDefinition): AppDefinition {
  return { ...app, about: BUILTIN_APP_ABOUT[app.id] }
}

export const APP_REGISTRY: AppDefinition[] = [
  withAbout({
    id: 'appstore',
    name: 'App Store',
    icon: AppStoreIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'browser',
    name: '网络浏览器',
    icon: BrowserIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'mail',
    name: '邮件',
    icon: MailIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'photos',
    name: '照片',
    icon: PhotosIcon,
    dock: false,
    desktop: false,
  }),
  withAbout({
    id: 'settings',
    name: '系统设置',
    icon: SettingsIcon,
    dock: true,
    desktop: false,
  }),
]

export const APP_COMPONENTS: Record<BuiltinAppId, ComponentType> = {
  appstore: AppStoreApp,
  browser: BrowserApp,
  mail: MailApp,
  photos: PlaceholderApp('photos', '照片'),
  settings: SettingsApp,
}

function PlaceholderApp(appId: BuiltinAppId, title: string): ComponentType {
  return function AppPlaceholder() {
    const { closeWindowsForApp, minimizeWindow, windows } = useOs()
    const { showBuiltinAbout } = useAboutApp()
    const definition = getAppDefinition(appId)

    const menuBar = useMemo((): MenuDefinition[] => {
      const appWindow = windows.find((window) => window.appId === appId && !window.minimized)

      return [
        {
          label: definition?.name ?? title,
          items: [
            ...aboutAppMenuPrefix(`关于 ${definition?.name ?? title}`, () => showBuiltinAbout(appId)),
            {
              type: 'action',
              label: `隐藏${definition?.name ?? title}`,
              shortcut: '⌘H',
              onClick: () => appWindow && minimizeWindow(appWindow.id),
            },
            { type: 'separator' },
            {
              type: 'action',
              label: `退出${definition?.name ?? title}`,
              shortcut: '⌘Q',
              onClick: () => closeWindowsForApp(appId),
            },
          ],
        },
      ]
    }, [closeWindowsForApp, definition?.name, minimizeWindow, showBuiltinAbout, title, windows])

    useAppMenuBar(appId, menuBar)

    return (
      <div class="placeholder-app">
        <p>{title}</p>
        <span>即将推出</span>
      </div>
    )
  }
}

export function getAppDefinition(appId: BuiltinAppId) {
  return APP_REGISTRY.find((app) => app.id === appId)
}
