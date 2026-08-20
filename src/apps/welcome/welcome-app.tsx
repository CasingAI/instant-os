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
import { IosButton } from '../../ui/ios-button.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { KeychainNavStack, useKeychainNavStack } from '../keychain/keychain-nav-stack.tsx'
import '../keychain/keychain.css'
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

type WelcomePage = 'list' | 'detail'
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
  const { hostRef, narrowLayout } = useAppNarrowLayout()
  const [keyAdded, setKeyAdded] = useState(() => hasOwnAiProvider())
  const [selectedId, setSelectedId] = useState<WelcomeTaskId>('setup-key')
  const {
    page,
    stack,
    transition,
    queuedTransition,
    commitQueuedTransition,
    navigate,
    handleMotionEnd,
    setPage,
  } = useKeychainNavStack<WelcomePage>('list')

  useAppMenuBar(APP_ID, [])

  useEffect(() => {
    return subscribeOpenAiConfig(() => {
      setKeyAdded(hasOwnAiProvider())
    })
  }, [])

  useEffect(() => {
    if (!narrowLayout) {
      setPage('list')
    }
  }, [narrowLayout, setPage])

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
      if (narrowLayout) {
        navigate('detail', 'push')
      }
    },
    [narrowLayout, navigate],
  )

  const handleBack = useCallback(() => {
    navigate('list', 'pop')
  }, [navigate])

  const renderPage = useCallback(
    (id: WelcomePage) => {
      if (id === 'detail') {
        return (
          <>
            <div class="settings__nav settings__nav--titled">
              <div class="settings__nav-bar">
                <IosNavBackButton label="欢迎中心" onClick={handleBack} />
                <h1 class="settings__nav-heading">{taskLabel(selected.id)}</h1>
                <span class="settings__nav-trailing" aria-hidden="true" />
              </div>
            </div>
            <div class="settings__content welcome-app__pane welcome-app__pane--hero">
              <WelcomeHero
                item={selected}
                keyAdded={keyAdded}
                iconSize={HERO_ICON_SIZE_NARROW}
                onOpen={openSelected}
              />
            </div>
          </>
        )
      }

      return (
        <>
          <div class="settings__nav settings__nav--titled">
            <div class="settings__nav-bar">
              <span class="settings__nav-heading-spacer" aria-hidden="true" />
              <h1 class="settings__nav-heading">欢迎中心</h1>
              <span class="settings__nav-trailing" aria-hidden="true" />
            </div>
          </div>
          <div class="settings__content welcome-app__pane">
            <WelcomeAppList
              narrowLayout
              selectedId={selected.id}
              onSelect={handleSelect}
            />
          </div>
        </>
      )
    },
    [handleBack, handleSelect, keyAdded, openSelected, selected],
  )

  return (
    <div
      ref={hostRef}
      class={`welcome-app${narrowLayout ? ' welcome-app--narrow' : ' welcome-app--wide'}`}
    >
      {narrowLayout ? (
        <KeychainNavStack
          stack={stack}
          page={page}
          transition={transition}
          queuedTransition={queuedTransition}
          commitQueuedTransition={commitQueuedTransition}
          onMotionEnd={handleMotionEnd}
          renderPage={renderPage}
          settingsClassName="welcome-app__page"
        />
      ) : (
        <>
          <WelcomeAppList
            narrowLayout={false}
            selectedId={selected.id}
            onSelect={handleSelect}
          />
          <WelcomeHero
            item={selected}
            keyAdded={keyAdded}
            iconSize={HERO_ICON_SIZE_WIDE}
            onOpen={openSelected}
          />
        </>
      )}
    </div>
  )
}
