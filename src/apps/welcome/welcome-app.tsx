import type { ComponentType } from 'preact'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { isActiveProviderInstantFree, subscribeOpenAiConfig } from '../../ai/openai-config.ts'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'
import {
  BooksIcon,
  BrowserIcon,
  CalendarIcon,
  CatGptIcon,
  FilesIcon,
  ForwardIcon,
  HelpIcon,
  InstantLogoIcon,
  KeychainIcon,
  MailIcon,
  MarketplaceIcon,
  MusicIcon,
  NewsIcon,
  SettingsIcon,
  TranslateIcon,
  WeatherIcon,
} from '../../icons/app-icons.tsx'
import { BUILTIN_APP_ABOUT } from '../../os/builtin-app-about-data.ts'
import { BUILTIN_APP_DISPLAY_NAMES } from '../../os/builtin-app-display-names.ts'
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

type WelcomePage = 'list' | 'detail'

type AppIcon = ComponentType<{ size?: number }>

type WelcomeItem = {
  appId: BuiltinAppId
  Icon: AppIcon
}

type WelcomeGroup = {
  id: string
  title: string
  items: readonly WelcomeItem[]
}

function InstantOsIcon({ size = 64 }: { size?: number }) {
  const mark = Math.round(size * 0.55)
  return (
    <AppIconTile color="#3d5a73" size={size}>
      <span class="welcome-app__os-mark" style={{ width: `${mark}px`, height: `${mark}px` }}>
        <InstantLogoIcon size={mark} />
      </span>
    </AppIconTile>
  )
}

const GROUPS: readonly WelcomeGroup[] = [
  {
    id: 'apps',
    title: '可以打开',
    items: [
      { appId: 'appstore', Icon: MarketplaceIcon },
      { appId: 'browser', Icon: BrowserIcon },
      { appId: 'catgpt', Icon: CatGptIcon },
      { appId: 'help', Icon: HelpIcon },
      { appId: 'files', Icon: FilesIcon },
      { appId: 'mail', Icon: MailIcon },
      { appId: 'news', Icon: NewsIcon },
      { appId: 'books', Icon: BooksIcon },
      { appId: 'music', Icon: MusicIcon },
      { appId: 'weather', Icon: WeatherIcon },
      { appId: 'calendar', Icon: CalendarIcon },
      { appId: 'translate', Icon: TranslateIcon },
    ],
  },
  {
    id: 'system',
    title: '系统',
    items: [
      { appId: 'system-info', Icon: InstantOsIcon },
      { appId: 'keychain', Icon: KeychainIcon },
      { appId: 'settings', Icon: SettingsIcon },
    ],
  },
]

const ALL_ITEMS: readonly WelcomeItem[] = GROUPS.flatMap((group) => group.items)

function findItem(appId: BuiltinAppId): WelcomeItem | undefined {
  return ALL_ITEMS.find((item) => item.appId === appId)
}

function itemLabel(appId: BuiltinAppId): string {
  return BUILTIN_APP_DISPLAY_NAMES[appId]
}

function previewHeadline(appId: BuiltinAppId): string {
  if (appId === 'system-info') return 'Instant OS'
  return BUILTIN_APP_ABOUT[appId]?.version ?? itemLabel(appId)
}

function previewBody(appId: BuiltinAppId, freeTier: boolean): string {
  if (appId === 'keychain') {
    return freeTier
      ? '当前已启用 Instant 共享 AI 通道，不填 Key 也能用。要用自己的模型：打开钥匙串 → AI 模型供应商 → 添加，填写 API Key。全部只保存在本机。'
      : '当前已在使用你配置的模型。可在钥匙串中添加或切换供应商；API Key 只保存在本机。'
  }
  if (appId === 'system-info') {
    return '由 AI 驱动的桌面环境：应用、网页、邮件与创意工具都可以在这里打开。点下面任意一项，这里会说明它是做什么的。'
  }
  return BUILTIN_APP_ABOUT[appId]?.paragraphs?.[0] ?? ''
}

function WelcomeHero({
  item,
  freeTier,
  iconSize,
  onOpen,
}: {
  item: WelcomeItem
  freeTier: boolean
  iconSize: number
  onOpen: () => void
}) {
  const Icon = item.Icon
  return (
    <header class="welcome-app__hero">
      <span class="welcome-app__watermark" aria-hidden="true">
        欢迎
      </span>
      <div class="welcome-app__hero-art" aria-hidden="true">
        <Icon size={iconSize} />
      </div>
      <div class="welcome-app__hero-copy">
        <h1 class="welcome-app__hero-title">{previewHeadline(item.appId)}</h1>
        <p class="welcome-app__hero-body">{previewBody(item.appId, freeTier)}</p>
        <IosButton size="compact" onClick={onOpen}>
          打开{itemLabel(item.appId)}
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
  selectedId: BuiltinAppId
  onSelect: (appId: BuiltinAppId) => void
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
            {group.items.map(({ appId, Icon }) => {
              const selectedItem = !narrowLayout && appId === selectedId
              return (
                <button
                  key={appId}
                  type="button"
                  role={narrowLayout ? undefined : 'option'}
                  aria-selected={narrowLayout ? undefined : selectedItem}
                  class={`welcome-app__item${selectedItem ? ' welcome-app__item--selected' : ''}`}
                  onClick={() => onSelect(appId)}
                >
                  <span class="welcome-app__item-icon" aria-hidden="true">
                    <Icon size={LIST_ICON_SIZE} />
                  </span>
                  <span class="welcome-app__item-name">{itemLabel(appId)}</span>
                  {narrowLayout ? (
                    <span class="welcome-app__item-chevron" aria-hidden="true">
                      <ForwardIcon size={13} />
                    </span>
                  ) : undefined}
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
  const [freeTier, setFreeTier] = useState(() => isActiveProviderInstantFree())
  const [selectedId, setSelectedId] = useState<BuiltinAppId>('system-info')
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
      setFreeTier(isActiveProviderInstantFree())
    })
  }, [])

  useEffect(() => {
    if (!narrowLayout) {
      setPage('list')
    }
  }, [narrowLayout, setPage])

  const selected = useMemo(() => findItem(selectedId) ?? ALL_ITEMS[0], [selectedId])

  const openSelected = useCallback(() => {
    openApp(selected.appId)
  }, [openApp, selected.appId])

  const handleSelect = useCallback(
    (appId: BuiltinAppId) => {
      setSelectedId(appId)
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
                <h1 class="settings__nav-heading">{itemLabel(selected.appId)}</h1>
                <span class="settings__nav-trailing" aria-hidden="true" />
              </div>
            </div>
            <div class="settings__content welcome-app__pane welcome-app__pane--hero">
              <WelcomeHero
                item={selected}
                freeTier={freeTier}
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
              selectedId={selected.appId}
              onSelect={handleSelect}
            />
          </div>
        </>
      )
    },
    [freeTier, handleBack, handleSelect, openSelected, selected],
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
            selectedId={selected.appId}
            onSelect={handleSelect}
          />
          <WelcomeHero
            item={selected}
            freeTier={freeTier}
            iconSize={HERO_ICON_SIZE_WIDE}
            onOpen={openSelected}
          />
        </>
      )}
    </div>
  )
}
