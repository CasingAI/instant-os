import type { ComponentType } from 'preact'
import type { BuiltinAppId, ExtAppId, GeneratedAppId } from './types.ts'

export type WindowAppComponent = ComponentType<{ windowId?: string }>

const APP_LOADERS: Record<BuiltinAppId, () => Promise<WindowAppComponent>> = {
  appstore: () => import('../apps/appstore/appstore-app.tsx').then((m) => m.MarketplaceApp),
  browser: () => import('../apps/browser/browser-app.tsx').then((m) => m.BrowserApp),
  chromo: () => import('../apps/chromo/chromo-app.tsx').then((m) => m.ChromoApp),
  'page-devtools': () =>
    import('../apps/page-devtools/page-devtools-app.tsx').then((m) => m.PageDevToolsApp),
  webview: () => import('../apps/webview/webview-app.tsx').then((m) => m.WebViewApp),
  mail: () => import('../apps/mail/mail-app.tsx').then((m) => m.MailApp),
  news: () => import('../apps/news/news-app.tsx').then((m) => m.NewsApp),
  books: () => import('../apps/books/books-app.tsx').then((m) => m.BooksApp),
  music: () => import('../apps/music/music-app.tsx').then((m) => m.MusicApp),
  stems: () => import('../apps/stems/stems-app.tsx').then((m) => m.StemsApp),
  weather: () => import('../apps/weather/weather-app.tsx').then((m) => m.WeatherApp),
  calendar: () => import('../apps/calendar/calendar-app.tsx').then((m) => m.CalendarApp),
  stocks: () => import('../apps/stocks/stocks-app.tsx').then((m) => m.StocksApp),
  translate: () => import('../apps/translate/translate-app.tsx').then((m) => m.TranslateApp),
  catgpt: () => import('../apps/catgpt/catgpt-app.tsx').then((m) => m.CatGptApp),
  produde: () => import('../apps/produde/produde-app.tsx').then((m) => m.ProdudeApp),
  gomoku: () => import('../apps/gomoku/gomoku-app.tsx').then((m) => m.GomokuApp),
  speech: () => import('../apps/speech/speech-app.tsx').then((m) => m.SpeechApp),
  files: () => import('../apps/files/files-app.tsx').then((m) => m.FilesApp),
  'file-info': () => import('../apps/file-info/file-info-app.tsx').then((m) => m.FileInfoApp),
  'files-op-progress': () =>
    import('../apps/files/files-op-progress-app.tsx').then((m) => m.FilesOpProgressApp),
  textedit: () => import('../apps/textedit/textedit-app.tsx').then((m) => m.TextEditApp),
  pages: () => import('../apps/pages/pages-app.tsx').then((m) => m.PagesApp),
  preview: () => import('../apps/preview/preview-app.tsx').then((m) => m.PreviewApp),
  vscode: () => import('../apps/vscode/vscode-app.tsx').then((m) => m.VscodeApp),
  'scene3d-lab': () =>
    import('../apps/scene3d-lab/scene3d-lab-app.tsx').then((m) => m.Scene3dLabApp),
  'model-vision': () =>
    import('../apps/model-vision/model-vision-app.tsx').then((m) => m.ModelVisionApp),
  icode: () => import('../apps/icode/icode-app.tsx').then((m) => m.ICodeApp),
  registry: () => import('../apps/registry/registry-app.tsx').then((m) => m.RegistryApp),
  settings: () => import('../apps/settings/settings-app.tsx').then((m) => m.SettingsApp),
  'system-info': () =>
    import('../apps/system-info/system-info-app.tsx').then((m) => m.SystemInfoApp),
  'task-manager': () =>
    import('../apps/task-manager/task-manager-app.tsx').then((m) => m.TaskManagerApp),
  services: () => import('../apps/services/services-app.tsx').then((m) => m.ServicesApp),
  'event-log': () => import('../apps/event-log/event-log-app.tsx').then((m) => m.EventLogApp),
  packages: () => import('../apps/packages/packages-app.tsx').then((m) => m.PackagesApp),
  'archive-utility': () =>
    import('../apps/archive-utility/archive-utility-app.tsx').then((m) => m.ArchiveUtilityApp),
  downloader: () => import('../apps/downloader/downloader-app.tsx').then((m) => m.DownloaderApp),
  'space-sniffer': () =>
    import('../apps/space-sniffer/space-sniffer-app.tsx').then((m) => m.SpaceSnifferApp),
  'disk-utility': () =>
    import('../apps/disk-utility/disk-utility-app.tsx').then((m) => m.DiskUtilityApp),
  keychain: () => import('../apps/keychain/keychain-app.tsx').then((m) => m.KeychainApp),
  // 平行验证期的新版钥匙串；验证通过后文件移回 apps/keychain/，本条与注册表条目一并移除。
  'keychain-next': () =>
    import('../apps/keychain-next/keychain-next-app.tsx').then((m) => m.KeychainNextApp),
  'github-desktop': () =>
    import('../apps/github-desktop/github-desktop-app.tsx').then((m) => m.GithubDesktopApp),
  help: () => import('../apps/help/help-app.tsx').then((m) => m.HelpApp),
  terminal: () => import('../apps/terminal/terminal-app.tsx').then((m) => m.TerminalApp),
  'simulated-terminal': () =>
    import('../apps/simulated-terminal/simulated-terminal-app.tsx').then(
      (m) => m.SimulatedTerminalApp,
    ),
  'virtual-js': () => import('../apps/virtual-js/virtual-js-app.tsx').then((m) => m.VirtualJsApp),
  'virtual-machine': () =>
    import('../apps/virtual-machine/virtual-machine-app.tsx').then((m) => m.VirtualMachineApp),
  'ui-kit': () => import('../apps/ui-kit/ui-kit-app.tsx').then((m) => m.UiKitApp),
  'srml-demo': () => import('../apps/srml-demo/srml-app.tsx').then((m) => m.SrmlDemoApp),
  'nav-kit-demo': () => import('../apps/nav-kit-demo/nav-kit-demo-app.tsx').then((m) => m.NavKitDemoApp),
  'midi-demo': () => import('../apps/midi-demo/midi-demo-app.tsx').then((m) => m.MidiDemoApp),
  'llm-playground': () =>
    import('../apps/llm-playground/llm-playground-app.tsx').then((m) => m.LlmPlaygroundApp),
  attunebench: () =>
    import('../apps/attunebench/attunebench-app.tsx').then((m) => m.AttuneBenchApp),
  welcome: () => import('../apps/welcome/welcome-app.tsx').then((m) => m.WelcomeApp),
  'welcome-next': () =>
    import('../apps/welcome-next/welcome-next-app.tsx').then((m) => m.WelcomeNextApp),
  'welcome-hello': () =>
    import('../apps/welcome-hello/welcome-hello-app.tsx').then((m) => m.WelcomeHelloApp),
}

const builtinInflight = new Map<BuiltinAppId, Promise<WindowAppComponent>>()
let generatedAppPromise: Promise<WindowAppComponent> | undefined
let extAppPromise: Promise<WindowAppComponent> | undefined

export function listBuiltinAppLoaderIds(): BuiltinAppId[] {
  return Object.keys(APP_LOADERS) as BuiltinAppId[]
}

export function loadBuiltinApp(appId: BuiltinAppId): Promise<WindowAppComponent> {
  const cached = builtinInflight.get(appId)
  if (cached) return cached

  const pending = APP_LOADERS[appId]().catch((error: unknown) => {
    builtinInflight.delete(appId)
    throw error
  })
  builtinInflight.set(appId, pending)
  return pending
}

export function loadGeneratedAppComponent(
  _appId: GeneratedAppId,
): Promise<WindowAppComponent> {
  generatedAppPromise ??= import('../apps/generated/generated-app.tsx')
    .then((m) => m.GeneratedApp as WindowAppComponent)
    .catch((error: unknown) => {
      generatedAppPromise = undefined
      throw error
    })
  return generatedAppPromise
}

export function loadExtAppComponent(_appId: ExtAppId): Promise<WindowAppComponent> {
  extAppPromise ??= import('../apps/ext/ext-app.tsx')
    .then((m) => m.ExtApp as WindowAppComponent)
    .catch((error: unknown) => {
      extAppPromise = undefined
      throw error
    })
  return extAppPromise
}
