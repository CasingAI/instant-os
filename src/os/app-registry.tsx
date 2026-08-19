import type { ComponentType } from 'preact'
import { Scene3dLabApp } from '../apps/scene3d-lab/scene3d-lab-app.tsx'
import { ModelVisionApp } from '../apps/model-vision/model-vision-app.tsx'
import { MarketplaceApp } from '../apps/appstore/appstore-app.tsx'
import { BrowserApp } from '../apps/browser/browser-app.tsx'
import { ChromoApp } from '../apps/chromo/chromo-app.tsx'
import { PageDevToolsApp } from '../apps/page-devtools/page-devtools-app.tsx'
import { WebViewApp } from '../apps/webview/webview-app.tsx'
import { MailApp } from '../apps/mail/mail-app.tsx'
import { SettingsApp } from '../apps/settings/settings-app.tsx'
import { NewsApp } from '../apps/news/news-app.tsx'
import { BooksApp } from '../apps/books/books-app.tsx'
import { WeatherApp } from '../apps/weather/weather-app.tsx'
import { CalendarApp } from '../apps/calendar/calendar-app.tsx'
import { StocksApp } from '../apps/stocks/stocks-app.tsx'
import { TranslateApp } from '../apps/translate/translate-app.tsx'
import { CatGptApp } from '../apps/catgpt/catgpt-app.tsx'
import { ProdudeApp } from '../apps/produde/produde-app.tsx'
import { GomokuApp } from '../apps/gomoku/gomoku-app.tsx'
import { HelpApp } from '../apps/help/help-app.tsx'
import { TerminalApp } from '../apps/terminal/terminal-app.tsx'
import { SimulatedTerminalApp } from '../apps/simulated-terminal/simulated-terminal-app.tsx'
import { VirtualJsApp } from '../apps/virtual-js/virtual-js-app.tsx'
import { SpeechApp } from '../apps/speech/speech-app.tsx'
import { ICodeApp } from '../apps/icode/icode-app.tsx'
import { RegistryApp } from '../apps/registry/registry-app.tsx'
import { SystemInfoApp } from '../apps/system-info/system-info-app.tsx'
import { TaskManagerApp } from '../apps/task-manager/task-manager-app.tsx'
import { ServicesApp } from '../apps/services/services-app.tsx'
import { EventLogApp } from '../apps/event-log/event-log-app.tsx'
import { PackagesApp } from '../apps/packages/packages-app.tsx'
import { ArchiveUtilityApp } from '../apps/archive-utility/archive-utility-app.tsx'
import { SpaceSnifferApp } from '../apps/space-sniffer/space-sniffer-app.tsx'
import { KeychainApp } from '../apps/keychain/keychain-app.tsx'
import { GithubDesktopApp } from '../apps/github-desktop/github-desktop-app.tsx'
import { FilesApp } from '../apps/files/files-app.tsx'
import { FileInfoApp } from '../apps/file-info/file-info-app.tsx'
import { FileInfoIcon } from '../apps/file-info/file-info-icon.tsx'
import { TextEditApp } from '../apps/textedit/textedit-app.tsx'
import { PagesApp } from '../apps/pages/pages-app.tsx'
import { PreviewApp } from '../apps/preview/preview-app.tsx'
import { VscodeApp } from '../apps/vscode/vscode-app.tsx'
import { UiKitApp } from '../apps/ui-kit/ui-kit-app.tsx'
import { MusicApp } from '../apps/music/music-app.tsx'
import { StemsApp } from '../apps/stems/stems-app.tsx'
import { SrmlDemoApp } from '../apps/srml-demo/srml-app.tsx'
import { MidiDemoApp } from '../apps/midi-demo/midi-demo-app.tsx'
import { LlmPlaygroundApp } from '../apps/llm-playground/llm-playground-app.tsx'
import { AttuneBenchApp } from '../apps/attunebench/attunebench-app.tsx'
import { WelcomeApp } from '../apps/welcome/welcome-app.tsx'
import { WelcomeNextApp } from '../apps/welcome-next/welcome-next-app.tsx'
import { WelcomeNextIcon } from '../apps/welcome-next/welcome-next-icon.tsx'
import { WelcomeHelloApp } from '../apps/welcome-hello/welcome-hello-app.tsx'
import { WelcomeHelloIcon } from '../apps/welcome-hello/welcome-hello-icon.tsx'
import { useAppMenuBar } from './menu-bar-context.tsx'
import { BrowserIcon, ChromoIcon, MarketplaceIcon, MailIcon, NewsIcon, BooksIcon, MusicIcon, StemsIcon, PhotosIcon, FilesIcon, TextEditIcon, PagesIcon, PreviewIcon, VscodeIcon, Scene3dLabIcon, ModelVisionIcon, ICodeIcon, SettingsIcon, StocksIcon, TranslateIcon, WeatherIcon, CalendarIcon, CatGptIcon, ProdudeIcon, GomokuIcon, SpeechIcon, InstantLogoIcon, TaskManagerIcon, ServicesIcon, EventLogIcon, PackagesIcon, ArchiveUtilityIcon, SpaceSnifferIcon, KeychainIcon, GithubDesktopIcon, HelpIcon, TerminalIcon, SimulatedTerminalIcon, VirtualJsIcon, UiKitIcon, SrmlDemoIcon, MidiDemoIcon, LlmPlaygroundIcon } from '../icons/app-icons.tsx'
import { RegistryIcon } from '../apps/registry/registry-icon.tsx'
import { AttuneBenchIcon } from '../apps/attunebench/attunebench-icon.tsx'
import { withAppIconDecoration } from '../icons/app-icon-decoration.tsx'
import { BUILTIN_APP_ABOUT } from './builtin-app-about-data.ts'
import { BUILTIN_APP_DISPLAY_NAMES } from './builtin-app-display-names.ts'
import type { AppDefinition, AppIconDecorationConfig, BuiltinAppId } from './types.ts'

const AI_RIBBON: AppIconDecorationConfig = { ribbon: { label: 'AI' } }
const DEV_SLEEVE: AppIconDecorationConfig = { sleeve: { label: '开发中' } }

function withAbout(app: AppDefinition): AppDefinition {
  return {
    ...app,
    about: BUILTIN_APP_ABOUT[app.id],
    icon: app.iconDecoration ? withAppIconDecoration(app.icon, app.iconDecoration) : app.icon,
  }
}

export const APP_REGISTRY: AppDefinition[] = [
  withAbout({
    id: 'appstore',
    name: BUILTIN_APP_DISPLAY_NAMES['appstore'],
    icon: MarketplaceIcon,
    dock: true,
    desktop: true,
    iconDecoration: AI_RIBBON,
  }),
  withAbout({
    id: 'browser',
    name: BUILTIN_APP_DISPLAY_NAMES['browser'],
    icon: BrowserIcon,
    dock: true,
    desktop: true,
    iconDecoration: AI_RIBBON,
  }),
  withAbout({
    id: 'chromo',
    name: BUILTIN_APP_DISPLAY_NAMES['chromo'],
    icon: ChromoIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'page-devtools',
    name: BUILTIN_APP_DISPLAY_NAMES['page-devtools'],
    icon: ChromoIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
    multiWindow: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'webview',
    name: BUILTIN_APP_DISPLAY_NAMES['webview'],
    icon: ChromoIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
    multiWindow: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'mail',
    name: BUILTIN_APP_DISPLAY_NAMES['mail'],
    icon: MailIcon,
    dock: true,
    desktop: true,
    iconDecoration: AI_RIBBON,
  }),
  withAbout({
    id: 'news',
    name: BUILTIN_APP_DISPLAY_NAMES['news'],
    icon: NewsIcon,
    dock: true,
    desktop: true,
    iconDecoration: AI_RIBBON,
  }),
  withAbout({
    id: 'books',
    name: BUILTIN_APP_DISPLAY_NAMES['books'],
    icon: BooksIcon,
    dock: true,
    desktop: true,
    iconDecoration: AI_RIBBON,
  }),
  withAbout({
    id: 'music',
    name: BUILTIN_APP_DISPLAY_NAMES['music'],
    icon: MusicIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'stems',
    name: BUILTIN_APP_DISPLAY_NAMES['stems'],
    icon: StemsIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'weather',
    name: BUILTIN_APP_DISPLAY_NAMES['weather'],
    icon: WeatherIcon,
    dock: true,
    desktop: true,
    iconDecoration: AI_RIBBON,
  }),
  withAbout({
    id: 'calendar',
    name: BUILTIN_APP_DISPLAY_NAMES['calendar'],
    icon: CalendarIcon,
    dock: true,
    desktop: true,
    iconDecoration: AI_RIBBON,
  }),
  withAbout({
    id: 'stocks',
    name: BUILTIN_APP_DISPLAY_NAMES['stocks'],
    icon: StocksIcon,
    dock: true,
    desktop: true,
    iconDecoration: AI_RIBBON,
  }),
  withAbout({
    id: 'translate',
    name: BUILTIN_APP_DISPLAY_NAMES['translate'],
    icon: TranslateIcon,
    dock: true,
    desktop: true,
    iconDecoration: AI_RIBBON,
  }),
  withAbout({
    id: 'catgpt',
    name: BUILTIN_APP_DISPLAY_NAMES['catgpt'],
    icon: CatGptIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'produde',
    name: BUILTIN_APP_DISPLAY_NAMES['produde'],
    icon: ProdudeIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'gomoku',
    name: BUILTIN_APP_DISPLAY_NAMES['gomoku'],
    icon: GomokuIcon,
    dock: true,
    desktop: true,
  }),
  // 【实验性 · 未完成】语音实验室；默认隐藏，见 experimental-settings-storage.speechApp
  withAbout({
    id: 'speech',
    name: BUILTIN_APP_DISPLAY_NAMES['speech'],
    icon: SpeechIcon,
    dock: false,
    desktop: false,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'photos',
    name: BUILTIN_APP_DISPLAY_NAMES['photos'],
    icon: PhotosIcon,
    dock: false,
    desktop: false,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'files',
    name: BUILTIN_APP_DISPLAY_NAMES['files'],
    icon: FilesIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'file-info',
    name: BUILTIN_APP_DISPLAY_NAMES['file-info'],
    icon: FileInfoIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
  }),
  withAbout({
    id: 'textedit',
    name: BUILTIN_APP_DISPLAY_NAMES['textedit'],
    icon: TextEditIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'pages',
    name: BUILTIN_APP_DISPLAY_NAMES['pages'],
    icon: PagesIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'preview',
    name: BUILTIN_APP_DISPLAY_NAMES['preview'],
    icon: PreviewIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'vscode',
    name: BUILTIN_APP_DISPLAY_NAMES['vscode'],
    icon: VscodeIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'scene3d-lab',
    name: BUILTIN_APP_DISPLAY_NAMES['scene3d-lab'],
    icon: Scene3dLabIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'model-vision',
    name: BUILTIN_APP_DISPLAY_NAMES['model-vision'],
    icon: ModelVisionIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'icode',
    name: BUILTIN_APP_DISPLAY_NAMES['icode'],
    icon: ICodeIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'registry',
    name: BUILTIN_APP_DISPLAY_NAMES['registry'],
    icon: RegistryIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
  }),
  withAbout({
    id: 'settings',
    name: BUILTIN_APP_DISPLAY_NAMES['settings'],
    icon: SettingsIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'system-info',
    name: BUILTIN_APP_DISPLAY_NAMES['system-info'],
    icon: InstantLogoIcon,
    dock: false,
    desktop: false,
  }),
  withAbout({
    id: 'task-manager',
    name: BUILTIN_APP_DISPLAY_NAMES['task-manager'],
    icon: TaskManagerIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
  }),
  withAbout({
    id: 'services',
    name: BUILTIN_APP_DISPLAY_NAMES['services'],
    icon: ServicesIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
  }),
  withAbout({
    id: 'event-log',
    name: BUILTIN_APP_DISPLAY_NAMES['event-log'],
    icon: EventLogIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
  }),
  withAbout({
    id: 'packages',
    name: BUILTIN_APP_DISPLAY_NAMES['packages'],
    icon: PackagesIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'archive-utility',
    name: BUILTIN_APP_DISPLAY_NAMES['archive-utility'],
    icon: ArchiveUtilityIcon,
    dock: true,
    dockWhenRunning: true,
    desktop: false,
    multiWindow: true,
  }),
  withAbout({
    id: 'space-sniffer',
    name: BUILTIN_APP_DISPLAY_NAMES['space-sniffer'],
    icon: SpaceSnifferIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: false,
  }),
  withAbout({
    id: 'keychain',
    name: BUILTIN_APP_DISPLAY_NAMES['keychain'],
    icon: KeychainIcon,
    dock: false,
    desktop: false,
  }),
  withAbout({
    id: 'github-desktop',
    name: BUILTIN_APP_DISPLAY_NAMES['github-desktop'],
    icon: GithubDesktopIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'help',
    name: BUILTIN_APP_DISPLAY_NAMES['help'],
    icon: HelpIcon,
    dock: true,
    desktop: true,
  }),
  withAbout({
    id: 'terminal',
    name: BUILTIN_APP_DISPLAY_NAMES['terminal'],
    icon: TerminalIcon,
    dock: true,
    desktop: true,
  }),
  /** @deprecated 模拟终端已弃用，此 AppDefinition 保留仅为过渡，后续移除。AppDefinition 结构体见 types.ts:AppDefinition */
  withAbout({
    id: 'simulated-terminal',
    name: BUILTIN_APP_DISPLAY_NAMES['simulated-terminal'],
    icon: SimulatedTerminalIcon,
    dock: false,
    desktop: false,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'virtual-js',
    name: BUILTIN_APP_DISPLAY_NAMES['virtual-js'],
    icon: VirtualJsIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'ui-kit',
    name: BUILTIN_APP_DISPLAY_NAMES['ui-kit'],
    icon: UiKitIcon,
    dock: false,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'srml-demo',
    name: BUILTIN_APP_DISPLAY_NAMES['srml-demo'],
    icon: SrmlDemoIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'midi-demo',
    name: BUILTIN_APP_DISPLAY_NAMES['midi-demo'],
    icon: MidiDemoIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'llm-playground',
    name: BUILTIN_APP_DISPLAY_NAMES['llm-playground'],
    icon: LlmPlaygroundIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'attunebench',
    name: BUILTIN_APP_DISPLAY_NAMES['attunebench'],
    icon: AttuneBenchIcon,
    dock: true,
    desktop: true,
    iconDecoration: DEV_SLEEVE,
  }),
  withAbout({
    id: 'welcome',
    name: BUILTIN_APP_DISPLAY_NAMES['welcome'],
    icon: InstantLogoIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: true,
  }),
  withAbout({
    id: 'welcome-next',
    name: BUILTIN_APP_DISPLAY_NAMES['welcome-next'],
    icon: WelcomeNextIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: true,
    iconDecoration: { sleeve: { label: '新' } },
  }),
  withAbout({
    id: 'welcome-hello',
    name: BUILTIN_APP_DISPLAY_NAMES['welcome-hello'],
    icon: WelcomeHelloIcon,
    dock: false,
    dockWhenRunning: true,
    desktop: true,
    iconDecoration: { sleeve: { label: '新' } },
  }),
]

export const APP_COMPONENTS: Record<BuiltinAppId, ComponentType<{ windowId?: string }>> = {
  appstore: MarketplaceApp,
  browser: BrowserApp,
  chromo: ChromoApp,
  'page-devtools': PageDevToolsApp,
  webview: WebViewApp,
  mail: MailApp,
  news: NewsApp,
  books: BooksApp,
  music: MusicApp,
  stems: StemsApp,
  weather: WeatherApp,
  calendar: CalendarApp,
  stocks: StocksApp,
  translate: TranslateApp,
  catgpt: CatGptApp,
  produde: ProdudeApp,
  gomoku: GomokuApp,
  speech: SpeechApp,
  photos: PlaceholderApp('photos', '照片'),
  files: FilesApp,
  'file-info': FileInfoApp,
  textedit: TextEditApp,
  pages: PagesApp,
  preview: PreviewApp,
  vscode: VscodeApp,
  'scene3d-lab': Scene3dLabApp,
  'model-vision': ModelVisionApp,
  icode: ICodeApp,
  registry: RegistryApp,
  settings: SettingsApp,
  'system-info': SystemInfoApp,
  'task-manager': TaskManagerApp,
  services: ServicesApp,
  'event-log': EventLogApp,
  packages: PackagesApp,
  'archive-utility': ArchiveUtilityApp,
  'space-sniffer': SpaceSnifferApp,
  keychain: KeychainApp,
  'github-desktop': GithubDesktopApp,
  help: HelpApp,
  terminal: TerminalApp,
  /** @deprecated 模拟终端已弃用，组件映射保留仅为过渡，后续移除 */
  'simulated-terminal': SimulatedTerminalApp,
  'virtual-js': VirtualJsApp,
  'ui-kit': UiKitApp,
  'srml-demo': SrmlDemoApp,
  'midi-demo': MidiDemoApp,
  'llm-playground': LlmPlaygroundApp,
  attunebench: AttuneBenchApp,
  welcome: WelcomeApp,
  'welcome-next': WelcomeNextApp,
  'welcome-hello': WelcomeHelloApp,
}

function PlaceholderApp(appId: BuiltinAppId, title: string): ComponentType {
  return function AppPlaceholder() {
    useAppMenuBar(appId, [])

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
