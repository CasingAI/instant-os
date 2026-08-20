import { useEffect, useState } from 'preact/hooks'
import appConfig from '../app.config.json'
import packageJson from '../package.json'
import { installInstantOsAiBridge } from './bridge/instant-os-ai-bridge.ts'
import { installInstantOsFilesBridge } from './bridge/instant-os-files-bridge.ts'
import { installInstantOsTerminalBridge } from './bridge/instant-os-terminal-bridge.ts'
import {
  buildRuntimeManifest,
  logAppBoot,
  notifyHostEnterProgram,
  readAppDisplayName,
  readAppId,
  readAppTags,
  resolveInstantOsRuntimeMode,
} from './bridge/instant-os-host.ts'
import { DevAiPlayground } from './components/DevAiPlayground.tsx'
import { SplashScreen } from './components/SplashScreen.tsx'
import { installDevToolkit } from './dev/install-dev-toolkit.ts'
import './app.css'

type AppConfig = {
  id: string
  name: string
  description: string
  themeColor: string
  tags: string[]
}

const config = appConfig as AppConfig

function resolveHostStatusLabel(): string {
  const mode = resolveInstantOsRuntimeMode()
  if (mode === 'host') {
    return '已向 Instant OS 宿主发送 enter 消息'
  }
  if (mode === 'dev-standalone') {
    return '开发模式：enter 已发出，可在 OS 悬浮球 → 日志 中查看'
  }
  return '独立预览：未检测到宿主（生产环境需由 Instant OS 打开）'
}

export function App() {
  const [phase, setPhase] = useState<'splash' | 'ready'>('splash')
  const [hostStatus, setHostStatus] = useState('启动中…')
  const manifest = buildRuntimeManifest()
  const hasAiTag = readAppTags().includes('ai')
  const hasFilesTag = readAppTags().includes('files')
  const hasTerminalTag = readAppTags().includes('terminal')

  useEffect(() => {
    logAppBoot()
    return installDevToolkit(readAppId())
  }, [])

  useEffect(() => {
    document.title = config.name

    const themeMeta = document.querySelector('meta[name="theme-color"]')
    if (themeMeta) {
      themeMeta.setAttribute('content', config.themeColor)
    }

    if (!hasAiTag) {
      return
    }

    return installInstantOsAiBridge({ appId: config.id, debug: import.meta.env.DEV })
  }, [hasAiTag])

  useEffect(() => {
    if (!hasFilesTag) {
      return
    }

    return installInstantOsFilesBridge({ appId: config.id })
  }, [hasFilesTag])

  useEffect(() => {
    if (!hasTerminalTag) {
      return
    }

    return installInstantOsTerminalBridge({ appId: config.id })
  }, [hasTerminalTag])

  const handleSplashComplete = () => {
    notifyHostEnterProgram()
    setHostStatus(resolveHostStatusLabel())
    setPhase('ready')
  }

  return (
    <>
      {phase === 'splash' ? <SplashScreen onComplete={handleSplashComplete} /> : undefined}
      {phase === 'ready' ? (
        <main class="app">
          <section class="app__card">
            <p class="app__eyebrow">Instant OS 外链应用</p>
            <h1 class="app__title">{readAppDisplayName()}</h1>
            <p class="app__description">{config.description}</p>
            <dl class="app__meta">
              <div>
                <dt>应用 ID</dt>
                <dd>{manifest.id}</dd>
              </div>
              <div>
                <dt>版本号</dt>
                <dd>{packageJson.version}</dd>
              </div>
              <div>
                <dt>入口</dt>
                <dd>{manifest.entry}</dd>
              </div>
              <div>
                <dt>宿主状态</dt>
                <dd>{hostStatus}</dd>
              </div>
            </dl>
          </section>
          {hasAiTag ? <DevAiPlayground /> : undefined}
        </main>
      ) : undefined}
    </>
  )
}
