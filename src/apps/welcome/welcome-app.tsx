import type { ComponentType } from 'preact'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { isInstantFreeProvider, isOpencodeZenProvider } from '../../ai/ai-providers.ts'
import { subscribeOpenAiConfig } from '../../ai/openai-config.ts'
import { BrowserIcon, ForwardIcon, KeychainIcon, MarketplaceIcon } from '../../icons/app-icons.tsx'
import { loadAccountSettings } from '../../os/account-settings-storage.ts'
import { openKeychainAiProvidersView } from '../../os/keychain-route-open.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import type { BuiltinAppId } from '../../os/types.ts'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import {
  AdaptiveSplitNav,
  useAdaptiveSplitNav,
  type AdaptiveFrameSpec,
} from '../../ui/adaptive-split-nav.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import '../settings/settings.css'
import './welcome.css'

const APP_ID = 'welcome' as const
const LIST_ICON_SIZE = 36
const HERO_ICON_SIZE = 112
const HERO_ICON_SIZE_NARROW = Math.round(HERO_ICON_SIZE * (4 / 3))
const HERO_ICON_SIZE_WIDE = Math.round(HERO_ICON_SIZE * 1.5)

const SETUP_KEY_STEPS = [
  '打开钥匙串。',
  '进「AI 模型供应商」，点右上角「添加」。出厂那条「Instant 共享AI」先别管。',
  '选一家你已有 Key 的，贴上 Key，勾要用的模型，保存。',
  '拖到列表最上面——首位才是首选。',
] as const

type WelcomeTaskId = 'setup-key' | 'open-browser' | 'try-appstore'
type AppIcon = ComponentType<{ size?: number }>

type WelcomeItem = {
  id: WelcomeTaskId
  Icon: AppIcon
  openAppId?: BuiltinAppId
}

type WelcomeGroup = {
  id: string
  title: string
  items: readonly WelcomeItem[]
}

const GROUPS: readonly WelcomeGroup[] = [
  {
    id: 'first',
    title: '先做这件事',
    items: [{ id: 'setup-key', Icon: KeychainIcon }],
  },
  {
    id: 'next',
    title: '然后可以试试',
    items: [
      { id: 'open-browser', Icon: BrowserIcon, openAppId: 'browser' },
      { id: 'try-appstore', Icon: MarketplaceIcon, openAppId: 'appstore' },
    ],
  },
]

const ALL_ITEMS: readonly WelcomeItem[] = GROUPS.flatMap((group) => group.items)

function hasOwnAiProvider(): boolean {
  const settings = loadAccountSettings()
  const providers = settings?.providers ?? []
  return providers.some((entry) => {
    if (isInstantFreeProvider(entry.providerId)) return false
    if (isOpencodeZenProvider(entry.providerId)) return true
    return entry.apiKey.trim().length > 0
  })
}

function findItem(id: WelcomeTaskId): WelcomeItem | undefined {
  return ALL_ITEMS.find((item) => item.id === id)
}

function taskLabel(id: WelcomeTaskId): string {
  if (id === 'setup-key') return '把 API Key 放进钥匙串'
  if (id === 'open-browser') return '打开网页浏览器'
  return '去应用集市装一个 App'
}

function taskBody(id: WelcomeTaskId): string {
  if (id === 'open-browser') {
    return '随便输个网址。没有网，是模型在演。'
  }
  return '描述一个 App，它给你装上。没有上架审核。'
}

function taskCta(id: WelcomeTaskId, keyAdded: boolean): string {
  if (id === 'setup-key') return keyAdded ? '已添加' : '去钥匙串添加'
  return taskLabel(id)
}

function WelcomeHero({
  item,
  keyAdded,
  iconSize,
  onOpen,
}: {
  item: WelcomeItem
  keyAdded: boolean
  iconSize: number
  onOpen: () => void
}) {
  const Icon = item.Icon
  const showSteps = item.id === 'setup-key'
  return (
    <header class="welcome-app__hero">
      <span class="welcome-app__watermark" aria-hidden="true">
        欢迎
      </span>
      <div class="welcome-app__hero-art" aria-hidden="true">
        <Icon size={iconSize} />
      </div>
      <div class="welcome-app__hero-copy">
        <h1 class="welcome-app__hero-title">{taskLabel(item.id)}</h1>
        {showSteps ? (
          <>
            <ol class="welcome-app__hero-steps">
              {SETUP_KEY_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p class="welcome-app__hero-hint">Key 只留在这台浏览器里，哪里都不上传。</p>
          </>
        ) : (
          <p class="welcome-app__hero-body welcome-app__hero-body--full">{taskBody(item.id)}</p>
        )}
        <IosButton
          size="compact"
          tone={item.id === 'setup-key' && !keyAdded ? 'primary' : 'secondary'}
          onClick={onOpen}
        >
          {taskCta(item.id, keyAdded)}
        </IosButton>
      </div>
    </header>
  )
}

function WelcomeAppList({
  narrowLayout,
  selectedId,
  onSelect,
}: {
  narrowLayout: boolean
  selectedId: WelcomeTaskId
  onSelect: (id: WelcomeTaskId) => void
}) {
  return (
    <div class="welcome-app__sidebar">
      {GROUPS.map((group) => (
        <section key={group.id} class="welcome-app__group">
          <h2 class="welcome-app__group-title">{group.title}</h2>
          <div
            class="welcome-app__items"
            role={narrowLayout ? 'list' : 'listbox'}
            aria-label={group.title}
          >
            {group.items.map(({ id, Icon }) => {
              const selectedItem = !narrowLayout && id === selectedId
              return (
                <button
                  key={id}
                  type="button"
                  role={narrowLayout ? undefined : 'option'}
                  aria-selected={narrowLayout ? undefined : selectedItem}
                  class={`welcome-app__item${selectedItem ? ' welcome-app__item--selected' : ''}`}
                  onClick={() => onSelect(id)}
                >
                  <span class="welcome-app__item-icon" aria-hidden="true">
                    <Icon size={LIST_ICON_SIZE} />
                  </span>
                  <span class="welcome-app__item-name">{taskLabel(id)}</span>
                  <span class="welcome-app__item-chevron" aria-hidden="true">
                    <ForwardIcon size={13} />
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export function WelcomeApp() {
  const { openApp } = useOs()
  const [keyAdded, setKeyAdded] = useState(() => hasOwnAiProvider())
  const [selectedId, setSelectedId] = useState<WelcomeTaskId>('setup-key')
  // 窄屏是否停在详情页：selectedId 恒有值推不出落点，用这个状态推导
  // 分栏切回子页栈时的落页
  const [detailOpen, setDetailOpen] = useState(false)

  const nav = useAdaptiveSplitNav({
    split: true,
    narrowPageForState: () => (detailOpen ? 'detail' : 'list'),
    listPage: 'list',
  })

  useAppMenuBar(APP_ID, [])

  useEffect(() => {
    return subscribeOpenAiConfig(() => {
      setKeyAdded(hasOwnAiProvider())
    })
  }, [])

  const selected = useMemo(() => findItem(selectedId) ?? ALL_ITEMS[0], [selectedId])

  const openSelected = useCallback(() => {
    if (selected.id === 'setup-key') {
      openKeychainAiProvidersView()
      return
    }
    if (selected.openAppId) {
      openApp(selected.openAppId)
    }
  }, [openApp, selected])

  const handleSelect = useCallback(
    (id: WelcomeTaskId) => {
      setSelectedId(id)
      if (nav.narrowLayout && nav.page === 'list') {
        setDetailOpen(true)
        nav.navigate('detail', 'push')
      }
    },
    [nav],
  )

  const handleBack = useCallback(() => {
    nav.navigate('list', 'pop', () => setDetailOpen(false))
  }, [nav])

  // ── 页面渲染：窄屏子页带导航栏；分栏左栏裸列表（老宽屏的无边框样式）──
  const renderNarrowPage = (target: string) => {
    if (target === 'detail') {
      return (
        <Page
          header={
            <PageHeader
              title={taskLabel(selected.id)}
              backLabel="欢迎中心"
              onBack={handleBack}
            />
          }
        >
          <WelcomeHero
            item={selected}
            keyAdded={keyAdded}
            iconSize={HERO_ICON_SIZE_NARROW}
            onOpen={openSelected}
          />
        </Page>
      )
    }
    if (nav.narrowLayout) {
      return (
        <Page header={<PageHeader title="欢迎中心" />}>
          <WelcomeAppList narrowLayout selectedId={selected.id} onSelect={handleSelect} />
        </Page>
      )
    }
    return <WelcomeAppList narrowLayout={false} selectedId={selected.id} onSelect={handleSelect} />
  }

  // 分栏帧：宽屏 hero 独占右栏，无导航栏（老宽屏样式）
  const renderWideFrames = (): AdaptiveFrameSpec[] => [
    {
      id: 'detail',
      content: (
        <WelcomeHero
          item={selected}
          keyAdded={keyAdded}
          iconSize={HERO_ICON_SIZE_WIDE}
          onOpen={openSelected}
        />
      ),
    },
  ]

  return (
    <AdaptiveSplitNav
      controller={nav}
      class={
        nav.narrowLayout ? 'welcome-app welcome-app--narrow' : 'welcome-app welcome-app--wide'
      }
      renderNarrowPage={renderNarrowPage}
      renderWideFrames={renderWideFrames}
      /* 对齐原宽屏固定 280px 侧栏的下限 */
      listMinWidth={280}
      listRatio={0.36}
    />
  )
}
