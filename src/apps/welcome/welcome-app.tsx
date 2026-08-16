import { useCallback, useMemo } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { isActiveProviderInstantFree } from '../../ai/openai-config.ts'
import {
  openSettingsAccountView,
  openSettingsDateTimeView,
} from '../../os/settings-route-open.ts'
import { InstantLogoIcon } from '../../icons/app-icons.tsx'
import './welcome.css'

const APP_ID = 'welcome' as const

export function WelcomeApp() {
  const { closeWindowsForApp, minimizeWindow, openApp, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const freeTier = isActiveProviderInstantFree()

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    return [
      {
        label: '欢迎',
        items: [
          ...aboutAppMenuPrefix('关于欢迎', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏欢迎',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出欢迎',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar(APP_ID, menuBar)

  const handleTryAi = useCallback(() => {
    openApp('catgpt')
  }, [openApp])

  return (
    <div class="welcome-app">
      <header class="welcome-app__hero">
        <div class="welcome-app__logo" aria-hidden="true">
          <InstantLogoIcon size={64} />
        </div>
        <h1 class="welcome-app__title">欢迎使用 Instant OS</h1>
        <p class="welcome-app__subtitle">
          由 AI 驱动的桌面环境：应用、网页、邮件与创意工具，全部即时生成、本地运行。
        </p>
      </header>

      <section class="welcome-app__section">
        <h2 class="welcome-app__section-title">从这里开始</h2>
        <div class="welcome-app__actions">
          <button type="button" class="welcome-app__action welcome-app__action--primary" onClick={handleTryAi}>
            <span class="welcome-app__action-label">立即体验 AI</span>
            <span class="welcome-app__action-hint">打开 CatGPT 对话，无需任何配置</span>
          </button>
          <button type="button" class="welcome-app__action" onClick={openSettingsAccountView}>
            <span class="welcome-app__action-label">配置 AI 账户</span>
            <span class="welcome-app__action-hint">接入自己的供应商与模型</span>
          </button>
          <button type="button" class="welcome-app__action" onClick={openSettingsDateTimeView}>
            <span class="welcome-app__action-label">设置系统时间</span>
            <span class="welcome-app__action-hint">手动设定或恢复系统时间</span>
          </button>
        </div>
      </section>

      <section class="welcome-app__section">
        <h2 class="welcome-app__section-title">系统能力</h2>
        <ul class="welcome-app__capabilities">
          <li>应用集市：一键安装由 AI 生成的微应用</li>
          <li>网页浏览器：输入网址，AI 实时生成页面</li>
          <li>Chromo / WebView：加载真实网页</li>
          <li>邮件、新闻、书架、音乐、办公套件等内置应用</li>
          <li>终端与 WebView 宿主：脚本化操作整个系统</li>
          <li>钥匙串：管理多供应商与模型偏好</li>
        </ul>
      </section>

      {freeTier && (
        <section class="welcome-app__section">
          <h2 class="welcome-app__section-title">AI 免费额度</h2>
          <p class="welcome-app__free-note">
            当前已启用 Instant 免费额度通道，无需 API Key 即可使用 AI。免费额度有并发与用量上限，适用于日常体验；需要更高额度时可在「配置 AI 账户」中接入自己的 Key。
          </p>
        </section>
      )}
    </div>
  )
}
