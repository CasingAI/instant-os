import type { ComponentType } from 'preact'
import { useMemo } from 'preact/hooks'
import { Scene3dLabApp } from '../apps/scene3d-lab/scene3d-lab-app.tsx'
import { MarketplaceApp } from '../apps/appstore/appstore-app.tsx'
import { BrowserApp } from '../apps/browser/browser-app.tsx'
import { MailApp } from '../apps/mail/mail-app.tsx'
import { SettingsApp } from '../apps/settings/settings-app.tsx'
import { NewsApp } from '../apps/news/news-app.tsx'
import { BooksApp } from '../apps/books/books-app.tsx'
import { WeatherApp } from '../apps/weather/weather-app.tsx'
import { StocksApp } from '../apps/stocks/stocks-app.tsx'
import { TranslateApp } from '../apps/translate/translate-app.tsx'
import { CatGptApp } from '../apps/catgpt/catgpt-app.tsx'
import { GomokuApp } from '../apps/gomoku/gomoku-app.tsx'
import { SpeechApp } from '../apps/speech/speech-app.tsx'
import { ICodeApp } from '../apps/icode/icode-app.tsx'
import { SystemInfoApp } from '../apps/system-info/system-info-app.tsx'
import { TaskManagerApp } from '../apps/task-manager/task-manager-app.tsx'
import { useAboutApp } from './about-app-context.tsx'
import { aboutAppMenuPrefix } from './about-app-menu.ts'
import { useAppMenuBar } from './menu-bar-context.tsx'
import type { MenuDefinition } from './menu-bar-types.ts'
import { useOs } from './os-context.tsx'
import { BrowserIcon, MarketplaceIcon, MailIcon, NewsIcon, BooksIcon, PhotosIcon, Scene3dLabIcon, ICodeIcon, SettingsIcon, StocksIcon, TranslateIcon, WeatherIcon, CatGptIcon, GomokuIcon, SpeechIcon, InstantLogoIcon, TaskManagerIcon } from '../icons/app-icons.tsx'
import { BUILTIN_APP_ABOUT } from './builtin-app-about.ts'
import type { AppDefinition, BuiltinAppId } from './types.ts'

function withAbout(app: AppDefinition): AppDefinition {
  return { ...app, about: BUILTIN_APP_ABOUT[app.id] }
}

export const APP_REGISTRY: AppDefinition[] = [
  withAbout({
    id: 'appstore',
    name: '应用集市',
    icon: MarketplaceIcon,
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
    id: 'news',
    name: '新闻',
    icon: NewsIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'books',
    name: '书架',
    icon: BooksIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'weather',
    name: '天气',
    icon: WeatherIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'stocks',
    name: '股票',
    icon: StocksIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'translate',
    name: '翻译',
    icon: TranslateIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'catgpt',
    name: 'CatGPT',
    icon: CatGptIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'gomoku',
    name: '五子棋',
    icon: GomokuIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'speech',
    name: '语音识别',
    icon: SpeechIcon,
    dock: false,
    desktop: false,
  }),
  withAbout({
    id: 'photos',
    name: '照片',
    icon: PhotosIcon,
    dock: false,
    desktop: false,
  }),
  withAbout({
    id: 'scene3d-lab',
    name: '3D 实验室',
    icon: Scene3dLabIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'icode',
    name: 'iCode',
    icon: ICodeIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'settings',
    name: '系统设置',
    icon: SettingsIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'system-info',
    name: '系统信息',
    icon: InstantLogoIcon,
    dock: false,
    desktop: false,
  }),
  withAbout({
    id: 'task-manager',
    name: '任务管理器',
    icon: TaskManagerIcon,
    dock: false,
    desktop: false,
  }),
]

export const APP_COMPONENTS: Record<BuiltinAppId, ComponentType> = {
  appstore: MarketplaceApp,
  browser: BrowserApp,
  mail: MailApp,
  news: NewsApp,
  books: BooksApp,
  weather: WeatherApp,
  stocks: StocksApp,
  translate: TranslateApp,
  catgpt: CatGptApp,
  gomoku: GomokuApp,
  speech: SpeechApp,
  photos: PlaceholderApp('photos', '照片'),
  'scene3d-lab': Scene3dLabApp,
  icode: ICodeApp,
  settings: SettingsApp,
  'system-info': SystemInfoApp,
  'task-manager': TaskManagerApp,
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
