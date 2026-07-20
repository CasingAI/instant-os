import type { ComponentType } from 'preact'
import { useMemo } from 'preact/hooks'
import { Scene3dLabApp } from '../apps/scene3d-lab/scene3d-lab-app.tsx'
import { ModelVisionApp } from '../apps/model-vision/model-vision-app.tsx'
import { MarketplaceApp } from '../apps/appstore/appstore-app.tsx'
import { BrowserApp } from '../apps/browser/browser-app.tsx'
import { MailApp } from '../apps/mail/mail-app.tsx'
import { SettingsApp } from '../apps/settings/settings-app.tsx'
import { NewsApp } from '../apps/news/news-app.tsx'
import { BooksApp } from '../apps/books/books-app.tsx'
import { WeatherApp } from '../apps/weather/weather-app.tsx'
import { CalendarApp } from '../apps/calendar/calendar-app.tsx'
import { StocksApp } from '../apps/stocks/stocks-app.tsx'
import { TranslateApp } from '../apps/translate/translate-app.tsx'
import { CatGptApp } from '../apps/catgpt/catgpt-app.tsx'
import { GomokuApp } from '../apps/gomoku/gomoku-app.tsx'
import { HelpApp } from '../apps/help/help-app.tsx'
import { TerminalApp } from '../apps/terminal/terminal-app.tsx'
import { SpeechApp } from '../apps/speech/speech-app.tsx'
import { ICodeApp } from '../apps/icode/icode-app.tsx'
import { SystemInfoApp } from '../apps/system-info/system-info-app.tsx'
import { TaskManagerApp } from '../apps/task-manager/task-manager-app.tsx'
import { EventLogApp } from '../apps/event-log/event-log-app.tsx'
import { KeychainApp } from '../apps/keychain/keychain-app.tsx'
import { FilesApp } from '../apps/files/files-app.tsx'
import { TextEditApp } from '../apps/textedit/textedit-app.tsx'
import { PreviewApp } from '../apps/preview/preview-app.tsx'
import { VscodeApp } from '../apps/vscode/vscode-app.tsx'
import { useAboutApp } from './about-app-context.tsx'
import { aboutAppMenuPrefix } from './about-app-menu.ts'
import { useAppMenuBar } from './menu-bar-context.tsx'
import type { MenuDefinition } from './menu-bar-types.ts'
import { useOs } from './os-context.tsx'
import { BrowserIcon, MarketplaceIcon, MailIcon, NewsIcon, BooksIcon, PhotosIcon, FilesIcon, TextEditIcon, PreviewIcon, VscodeIcon, Scene3dLabIcon, ModelVisionIcon, ICodeIcon, SettingsIcon, StocksIcon, TranslateIcon, WeatherIcon, CalendarIcon, CatGptIcon, GomokuIcon, SpeechIcon, InstantLogoIcon, TaskManagerIcon, EventLogIcon, KeychainIcon, HelpIcon, TerminalIcon } from '../icons/app-icons.tsx'
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
    id: 'calendar',
    name: '月历',
    icon: CalendarIcon,
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
  // 【实验性 · 未完成】语音实验室；默认隐藏，见 experimental-settings-storage.speechApp
  withAbout({
    id: 'speech',
    name: '语音实验室',
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
    id: 'files',
    name: '文件',
    icon: FilesIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'textedit',
    name: '文本编辑',
    icon: TextEditIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'preview',
    name: '预览',
    icon: PreviewIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'vscode',
    name: 'Virtual Studio Code',
    icon: VscodeIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'scene3d-lab',
    name: '3D 实验室',
    icon: Scene3dLabIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'model-vision',
    name: '模型识图',
    icon: ModelVisionIcon,
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
    name: '性能监视器',
    icon: TaskManagerIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
  }),
  withAbout({
    id: 'event-log',
    name: '事件日志',
    icon: EventLogIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
  }),
  withAbout({
    id: 'keychain',
    name: '钥匙串',
    icon: KeychainIcon,
    dock: false,
    desktop: false,
  }),
  withAbout({
    id: 'help',
    name: '帮助',
    icon: HelpIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'terminal',
    name: '终端',
    icon: TerminalIcon,
    dock: true,
    desktop: true,
  }),
]

export const APP_COMPONENTS: Record<BuiltinAppId, ComponentType<{ windowId?: string }>> = {
  appstore: MarketplaceApp,
  browser: BrowserApp,
  mail: MailApp,
  news: NewsApp,
  books: BooksApp,
  weather: WeatherApp,
  calendar: CalendarApp,
  stocks: StocksApp,
  translate: TranslateApp,
  catgpt: CatGptApp,
  gomoku: GomokuApp,
  speech: SpeechApp,
  photos: PlaceholderApp('photos', '照片'),
  files: FilesApp,
  textedit: TextEditApp,
  preview: PreviewApp,
  vscode: VscodeApp,
  'scene3d-lab': Scene3dLabApp,
  'model-vision': ModelVisionApp,
  icode: ICodeApp,
  settings: SettingsApp,
  'system-info': SystemInfoApp,
  'task-manager': TaskManagerApp,
  'event-log': EventLogApp,
  keychain: KeychainApp,
  help: HelpApp,
  terminal: TerminalApp,
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
