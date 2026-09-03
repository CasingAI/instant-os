import type { ComponentType } from 'preact'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
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

  // 落点规则与其他分栏应用一致（磁盘工具/服务/注册表）：由选中态推导。
  // selectedId 恒有值 → 宽→窄翻转恒落详情页、播 C 型（面板扩张），不再有
  // 「点过才算进详情」的人工门控（服务/磁盘工具靠载入自动选中达到同效果）。
  // 窄屏首页例外见下方挂载 effect。
  const nav = useAdaptiveSplitNav({
    split: true,
    narrowPageForState: () => (selectedId ? 'detail' : 'list'),
    listPage: 'list',
  })

  // 窄屏首次打开应停在首页列表，而 initialPage 取 narrowPageForState() 恒为
  // detail：挂载 paint 前静默换回列表，仅此一次，之后的翻转落点仍按规则落详情。
  const homeFixedRef = useRef(false)
  useLayoutEffect(() => {
    if (homeFixedRef.current) return
    homeFixedRef.current = true
    nav.setPageSilent('list')
  }, [nav])

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
        nav.navigate('detail', 'push')
      }
    },
    [nav],
  )

  const handleBack = useCallback(() => {
    nav.navigate('list', 'pop')
  }, [nav])

  // ── 形变期返回键对齐（disk-utility 同款）：详情页/帧的返回键只在窄形态
  // 有、分栏静置没有。A 型（窄→宽）先挂着随滑轨淡出；C 型（宽→窄）落定
  // 交棒给子页栈后才出现，给一次透明度 0→1 的短淡入代替硬蹦。epoch 递增 +
  // 双类名交替，背靠背再触发也能重播；必须用 layout effect，类要在面板移
  // 除的同一帧 paint 前挂上。
  const [backFadeEpoch, setBackFadeEpoch] = useState(0)
  const backFadeTimerRef = useRef(0)
  const prevMorphingRef = useRef(false)
  useLayoutEffect(() => {
    const was = prevMorphingRef.current
    prevMorphingRef.current = nav.morphing
    if (was === nav.morphing) return
    if (nav.morphing || !nav.narrowLayout) return
    if (nav.page !== 'detail') return
    window.clearTimeout(backFadeTimerRef.current)
    setBackFadeEpoch((epoch) => epoch + 1)
    backFadeTimerRef.current = window.setTimeout(() => setBackFadeEpoch(0), 320)
  }, [nav.morphing, nav.narrowLayout, nav.page])
  useEffect(() => () => window.clearTimeout(backFadeTimerRef.current), [])

  // ── 页面渲染：两形态同一份 Page + PageHeader 壳（Header 常驻），返回键
  // 按形态挂/摘 ──
  const renderNarrowPage = (target: string) => {
    if (target === 'detail') {
      return (
        <Page
          header={
            <PageHeader
              class={
                backFadeEpoch > 0 && target === nav.page
                  ? `welcome__back-fade-in-${backFadeEpoch % 2}`
                  : undefined
              }
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
    return (
      <Page header={<PageHeader title="欢迎中心" />}>
        <WelcomeAppList
          narrowLayout={nav.narrowLayout}
          selectedId={selected.id}
          onSelect={handleSelect}
        />
      </Page>
    )
  }

  // 分栏帧：hero 帧静置不带返回（左栏列表即它的上级），A 型形变（窄→宽）
  // 先挂着返回随滑轨淡出。
  const keepDetailBack = nav.morphing && nav.morphKind === 'A'
  const renderWideFrames = (): AdaptiveFrameSpec[] => [
    {
      id: 'detail',
      content: (
        <Page
          header={
            <PageHeader
              class={keepDetailBack ? 'welcome__back-fade-out' : undefined}
              title={taskLabel(selected.id)}
              backLabel={keepDetailBack ? '欢迎中心' : undefined}
              onBack={keepDetailBack ? handleBack : undefined}
            />
          }
        >
          <WelcomeHero
            item={selected}
            keyAdded={keyAdded}
            iconSize={HERO_ICON_SIZE_WIDE}
            onOpen={openSelected}
          />
        </Page>
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
