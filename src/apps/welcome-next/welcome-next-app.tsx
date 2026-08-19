import type { ComponentType } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  isActiveProviderInstantFree,
  subscribeOpenAiConfig,
} from '../../ai/openai-config.ts'
import { isInstantFreeProvider, isOpencodeZenProvider } from '../../ai/ai-providers.ts'
import {
  BooksIcon,
  BrowserIcon,
  CalendarIcon,
  CatGptIcon,
  GomokuIcon,
  ICodeIcon,
  MailIcon,
  MarketplaceIcon,
  NewsIcon,
  StocksIcon,
  TranslateIcon,
  WeatherIcon,
} from '../../icons/app-icons.tsx'
import { loadAccountSettings } from '../../os/account-settings-storage.ts'
import { BUILTIN_APP_DISPLAY_NAMES } from '../../os/builtin-app-display-names.ts'
import { openKeychainAiProvidersView } from '../../os/keychain-route-open.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import type { BuiltinAppId } from '../../os/types.ts'
import { IosButton } from '../../ui/ios-button.tsx'
import './welcome-next.css'

const APP_ID = 'welcome-next' as const
const TILE_ICON_SIZE = 48

type AppIcon = ComponentType<{ size?: number }>
type KeyStatus = 'needs-key' | 'needs-preferred' | 'ready'

type ShowcaseItem = {
  appId: BuiltinAppId
  Icon: AppIcon
  blurb: string
}

type ShowcaseCluster = {
  id: string
  label: string
  items: readonly ShowcaseItem[]
}

const CLUSTERS: readonly ShowcaseCluster[] = [
  {
    id: 'grow',
    label: '会凭空长出东西',
    items: [
      { appId: 'browser', Icon: BrowserIcon, blurb: '随便输个网址。没有网，是模型在演。' },
      { appId: 'appstore', Icon: MarketplaceIcon, blurb: '描述一个 App，它给你装上。没有上架审核。' },
      { appId: 'mail', Icon: MailIcon, blurb: '收件箱是编的。回信的那个人也是。' },
    ],
  },
  {
    id: 'pretend',
    label: '假得认真',
    items: [
      { appId: 'news', Icon: NewsIcon, blurb: '假头条。日期还能拨到古代或未来。' },
      { appId: 'books', Icon: BooksIcon, blurb: '假网文，真长。生成完才能翻。' },
      { appId: 'weather', Icon: WeatherIcon, blurb: '搜任何城市都有预报。都是编的。' },
      { appId: 'stocks', Icon: StocksIcon, blurb: '假行情看板。别拿去下单。' },
      { appId: 'calendar', Icon: CalendarIcon, blurb: '月历跟着系统时间走，古代节气也算。' },
    ],
  },
  {
    id: 'play',
    label: '纯玩的',
    items: [
      { appId: 'catgpt', Icon: CatGptIcon, blurb: '你说话，神喵喵喵。' },
      { appId: 'translate', Icon: TranslateIcon, blurb: '只会把中文译成哈基语一类宇宙话。' },
      { appId: 'gomoku', Icon: GomokuIcon, blurb: '五子棋。可以让模型和你下，也可以让两个模型互啄。' },
    ],
  },
  {
    id: 'work',
    label: '也能干正经事',
    items: [
      { appId: 'icode', Icon: ICodeIcon, blurb: '让它写一个真能点的小程序。' },
    ],
  },
]

const HELP_BLURB = '用中文问系统怎么用。它自己也是一只 AI，所以也要先有钥匙。'

function readKeyStatus(): KeyStatus {
  const settings = loadAccountSettings()
  const providers = settings?.providers ?? []
  const hasOwn = providers.some((entry) => {
    if (isInstantFreeProvider(entry.providerId)) return false
    if (isOpencodeZenProvider(entry.providerId)) return true
    return entry.apiKey.trim().length > 0
  })
  if (!hasOwn) return 'needs-key'
  if (isActiveProviderInstantFree()) return 'needs-preferred'
  return 'ready'
}

function itemLabel(appId: BuiltinAppId): string {
  return BUILTIN_APP_DISPLAY_NAMES[appId]
}

export function WelcomeNextApp() {
  const { openApp } = useOs()
  const showcaseRef = useRef<HTMLElement>(null)
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(() => readKeyStatus())
  const [hoveredId, setHoveredId] = useState<BuiltinAppId | undefined>(undefined)
  const [browsing, setBrowsing] = useState(false)

  useAppMenuBar(APP_ID, [])

  useEffect(() => {
    return subscribeOpenAiConfig(() => {
      setKeyStatus(readKeyStatus())
    })
  }, [])

  const hovered = useMemo(() => {
    if (!hoveredId) return undefined
    if (hoveredId === 'help') {
      return { name: itemLabel('help'), blurb: HELP_BLURB }
    }
    for (const cluster of CLUSTERS) {
      const item = cluster.items.find((entry) => entry.appId === hoveredId)
      if (item) {
        return { name: itemLabel(item.appId), blurb: item.blurb }
      }
    }
    return undefined
  }, [hoveredId])

  const openKeychain = useCallback(() => {
    openKeychainAiProvidersView()
  }, [])

  const wander = useCallback(() => {
    setBrowsing(true)
    showcaseRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const openTile = useCallback(
    (appId: BuiltinAppId) => {
      openApp(appId)
    },
    [openApp],
  )

  const identity =
    keyStatus === 'ready'
      ? {
          kicker: 'Instant OS',
          title: '钥匙插上了',
          lede: '下面这些都可以乱点。想换模型，还是去钥匙串。',
        }
      : keyStatus === 'needs-preferred'
        ? {
            kicker: 'Instant OS',
            title: '钥匙加好了，还差一步',
            lede: '把你刚加的那条拖到最上面，才会真正用上它。否则还在走共享通道。',
          }
        : {
            kicker: 'Instant OS',
            title: '你刚走进一台会编故事的电脑',
            lede: '网页、邮件、新闻、书架……都还是空的。它们会用你的模型当场写出来。',
          }

  const showFullSteps = keyStatus === 'needs-key' && !browsing
  const noteReady = keyStatus === 'ready'

  return (
    <div class="welcome-next">
      <header class="welcome-next__identity">
        <p class="welcome-next__kicker">{identity.kicker}</p>
        <h1 class="welcome-next__title">{identity.title}</h1>
        <p class="welcome-next__lede">{identity.lede}</p>
      </header>

      <section
        class={`welcome-next__note${noteReady ? ' welcome-next__note--ready' : ''}`}
        aria-label="配置 API Key"
      >
        {keyStatus === 'needs-key' ? (
          <>
            <h2 class="welcome-next__note-title">先把你的 API Key 插上</h2>
            {showFullSteps ? (
              <>
                <ol class="welcome-next__steps">
                  <li>打开钥匙串。</li>
                  <li>
                    进「AI 模型供应商」，点右上角「添加」。出厂那条「Instant
                    共享AI」先别管。
                  </li>
                  <li>
                    选一家你已有 Key 的（DeepSeek / 小米都行），贴上 Key，勾要用的模型，保存。
                  </li>
                  <li>拖到列表最上面——首位才是首选。</li>
                </ol>
                <p class="welcome-next__hint">
                  定价、上下文窗口、GitHub Token 都可以以后再说。Key
                  只留在这台浏览器里，哪里都不上传。大约两分钟，有点绕，随时可以关这个窗。
                </p>
              </>
            ) : (
              <p class="welcome-next__note-body">
                大部分房间现在是空的。想让它们活过来，还是得去钥匙串加一家供应商。
              </p>
            )}
            <div class="welcome-next__actions">
              <IosButton tone="primary" onClick={openKeychain}>
                去插钥匙
              </IosButton>
              {showFullSteps ? (
                <IosButton onClick={wander}>我先逛逛</IosButton>
              ) : undefined}
            </div>
          </>
        ) : keyStatus === 'needs-preferred' ? (
          <>
            <h2 class="welcome-next__note-title">差一步：拖到最上面</h2>
            <p class="welcome-next__note-body">
              你已经加过自己的供应商，但当前首选还是共享通道。打开钥匙串 → AI
              模型供应商，把那条拖到第一位。
            </p>
            <div class="welcome-next__actions">
              <IosButton tone="primary" onClick={openKeychain}>
                去排一下
              </IosButton>
            </div>
          </>
        ) : (
          <>
            <h2 class="welcome-next__note-title">模型已经接上</h2>
            <p class="welcome-next__note-body">
              要换一家，或再加一把钥匙，随时打开钥匙串。
            </p>
            <div class="welcome-next__actions">
              <IosButton onClick={openKeychain}>打开钥匙串</IosButton>
            </div>
          </>
        )}
      </section>

      <section ref={showcaseRef} class="welcome-next__showcase">
        <h2 class="welcome-next__showcase-title">
          {keyStatus === 'ready' ? '可以乱点' : '配好之后可以乱点'}
        </h2>
        <div class="welcome-next__clusters">
          {CLUSTERS.map((cluster) => (
            <div key={cluster.id}>
              <p class="welcome-next__cluster-label">{cluster.label}</p>
              <div class="welcome-next__tiles">
                {cluster.items.map(({ appId, Icon }) => (
                  <button
                    key={appId}
                    type="button"
                    class="welcome-next__tile"
                    onClick={() => openTile(appId)}
                    onMouseEnter={() => setHoveredId(appId)}
                    onMouseLeave={() =>
                      setHoveredId((current) => (current === appId ? undefined : current))
                    }
                    onFocus={() => setHoveredId(appId)}
                    onBlur={() =>
                      setHoveredId((current) => (current === appId ? undefined : current))
                    }
                  >
                    <span class="welcome-next__tile-icon" aria-hidden="true">
                      <Icon size={TILE_ICON_SIZE} />
                    </span>
                    <span class="welcome-next__tile-name">{itemLabel(appId)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p class="welcome-next__blurb">
          {hovered
            ? `${hovered.name}：${hovered.blurb}`
            : keyStatus === 'needs-key'
              ? '这些房间现在多半是空的。把鼠标放在图标上，或直接点开看看。'
              : '把鼠标放在图标上，或直接点开。'}
        </p>
      </section>

      <p class="welcome-next__foot">
        迷路了去问
        <button
          type="button"
          class="welcome-next__link"
          onClick={() => openTile('help')}
          onMouseEnter={() => setHoveredId('help')}
          onMouseLeave={() =>
            setHoveredId((current) => (current === 'help' ? undefined : current))
          }
        >
          帮助
        </button>
        ——它也是一只 AI，所以也要先有钥匙。
      </p>
    </div>
  )
}
