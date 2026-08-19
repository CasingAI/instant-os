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
import './welcome.css'

const APP_ID = 'welcome' as const
const LIST_ICON_SIZE = 36
const HERO_ICON_SIZE = 112

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
  onOpen,
}: {
  item: WelcomeItem
  freeTier: boolean
  onOpen: () => void
}) {
  const Icon = item.Icon
  return (
    <header class="welcome-app__hero">
      <span class="welcome-app__watermark" aria-hidden="true">
        欢迎
      </span>
      <div class="welcome-app__hero-art" aria-hidden="true">
        <Icon size={HERO_ICON_SIZE} />
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

export function WelcomeApp() {
  const { openApp } = useOs()
  const { hostRef, narrowLayout } = useAppNarrowLayout()
  const [freeTier, setFreeTier] = useState(() => isActiveProviderInstantFree())
  const [selectedId, setSelectedId] = useState<BuiltinAppId>('system-info')
  const [detailOpen, setDetailOpen] = useState(false)

  useAppMenuBar(APP_ID, [])

  useEffect(() => {
    return subscribeOpenAiConfig(() => {
      setFreeTier(isActiveProviderInstantFree())
    })
  }, [])

  const selected = useMemo(() => findItem(selectedId) ?? ALL_ITEMS[0], [selectedId])

  const openSelected = useCallback(() => {
    openApp(selected.appId)
  }, [openApp, selected.appId])

  const handleSelect = useCallback(
    (appId: BuiltinAppId) => {
      setSelectedId(appId)
      if (narrowLayout) {
        setDetailOpen(true)
      }
    },
    [narrowLayout],
  )

  const showNarrowDetail = narrowLayout && detailOpen

  return (
    <div
      ref={hostRef}
      class={`welcome-app${narrowLayout ? ' welcome-app--narrow' : ' welcome-app--wide'}${
        showNarrowDetail ? ' welcome-app--detail' : ''
      }`}
    >
      {showNarrowDetail ? (
        <>
          <div class="welcome-app__nav">
            <IosNavBackButton label="欢迎中心" onClick={() => setDetailOpen(false)} />
          </div>
          <WelcomeHero item={selected} freeTier={freeTier} onOpen={openSelected} />
        </>
      ) : (
        <>
          {narrowLayout ? (
            <div class="welcome-app__nav">
              <h1 class="welcome-app__nav-title">欢迎中心</h1>
            </div>
          ) : (
            <WelcomeHero item={selected} freeTier={freeTier} onOpen={openSelected} />
          )}
          <div class="welcome-app__columns">
            {GROUPS.map((group) => (
              <section key={group.id} class="welcome-app__group">
                <h2 class="welcome-app__group-title">{group.title}</h2>
                <div
                  class="welcome-app__items"
                  role={narrowLayout ? 'list' : 'listbox'}
                  aria-label={group.title}
                >
                  {group.items.map(({ appId, Icon }) => {
                    const selectedItem = !narrowLayout && appId === selected.appId
                    return (
                      <button
                        key={appId}
                        type="button"
                        role={narrowLayout ? undefined : 'option'}
                        aria-selected={narrowLayout ? undefined : selectedItem}
                        class={`welcome-app__item${
                          selectedItem ? ' welcome-app__item--selected' : ''
                        }`}
                        onClick={() => handleSelect(appId)}
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
        </>
      )}
    </div>
  )
}
