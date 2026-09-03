import type { ComponentType } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  isActiveProviderInstantFree,
  subscribeOpenAiConfig,
} from '../../ai/openai-config.ts'
import { isInstantFreeProvider, isOpencodeZenProvider } from '../../ai/ai-providers.ts'
import {
  BrowserIcon,
  InstantLogoIcon,
  MailIcon,
  MarketplaceIcon,
} from '../../icons/app-icons.tsx'
import { loadAccountSettings } from '../../os/account-settings-storage.ts'
import { BUILTIN_APP_DISPLAY_NAMES } from '../../os/builtin-app-display-names.ts'
import { openKeychainAiProvidersView } from '../../os/keychain-route-open.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import type { BuiltinAppId } from '../../os/types.ts'
import { Button } from '../../ui/button.tsx'
import './welcome-hello.css'

const APP_ID = 'welcome-hello' as const
const SECTION_COUNT = 4
const HELLO_WORDS = ['你好', 'Hello', 'こんにちは', 'Bonjour', 'Hola', 'Ciao'] as const
const HELLO_INTERVAL_MS = 1600

type AppIcon = ComponentType<{ size?: number }>
type KeyStatus = 'needs-key' | 'needs-preferred' | 'ready'

type FeaturedItem = {
  appId: BuiltinAppId
  Icon: AppIcon
  blurb: string
}

const FEATURED: readonly FeaturedItem[] = [
  { appId: 'browser', Icon: BrowserIcon, blurb: '随便输个网址。没有网，是模型在演。' },
  { appId: 'appstore', Icon: MarketplaceIcon, blurb: '描述一个 App，它给你装上。' },
  { appId: 'mail', Icon: MailIcon, blurb: '收件箱是编的。回信的那个人也是。' },
]

const FACTS = [
  '打开网页、邮件、新闻时，里面还是空的。模型会当场写出来。',
  '钥匙只留在这台浏览器里，哪里都不上传。',
  '这扇窗随时能关。后面的桌面才是正事。',
] as const

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

export function WelcomeHelloApp({ windowId }: { windowId?: string }) {
  const { openApp, closeWindowsForApp, activeWindowId } = useOs()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const [page, setPage] = useState(0)
  const [helloIndex, setHelloIndex] = useState(0)
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(() => readKeyStatus())

  useAppMenuBar(APP_ID, [])

  useEffect(() => {
    return subscribeOpenAiConfig(() => {
      setKeyStatus(readKeyStatus())
    })
  }, [])

  useEffect(() => {
    if (page !== 0) return undefined
    const timer = window.setInterval(() => {
      setHelloIndex((current) => (current + 1) % HELLO_WORDS.length)
    }, HELLO_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [page])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return undefined

    let frame = 0
    const syncPage = () => {
      frame = 0
      const top = scroller.scrollTop
      let active = 0
      for (let index = 0; index < sectionRefs.current.length; index += 1) {
        const section = sectionRefs.current[index]
        if (section && section.offsetTop <= top + 48) {
          active = index
        }
      }
      setPage(active)
    }

    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(syncPage)
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    syncPage()
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  const scrollToSection = useCallback((index: number) => {
    const scroller = scrollerRef.current
    const section = sectionRefs.current[Math.max(0, Math.min(SECTION_COUNT - 1, index))]
    if (!scroller || !section) return
    scroller.scrollTo({ top: section.offsetTop })
  }, [])

  const finish = useCallback(() => {
    closeWindowsForApp(APP_ID)
  }, [closeWindowsForApp])

  const openKeychain = useCallback(() => {
    openKeychainAiProvidersView()
  }, [])

  const openFeatured = useCallback(
    (appId: BuiltinAppId) => {
      openApp(appId)
    },
    [openApp],
  )

  const bindSection = useCallback((index: number) => {
    return (node: HTMLElement | null) => {
      sectionRefs.current[index] = node
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (windowId && activeWindowId !== windowId) return
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        if (page >= SECTION_COUNT - 1) finish()
        else scrollToSection(page + 1)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        scrollToSection(page - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeWindowId, finish, page, scrollToSection, windowId])

  const lastPage = page === SECTION_COUNT - 1
  const helloWord = HELLO_WORDS[helloIndex] ?? HELLO_WORDS[0]

  const onPeekClick = useCallback(
    (index: number, event: MouseEvent) => {
      if (index === page) return
      const target = event.target
      if (target instanceof Element && target.closest('button')) return
      scrollToSection(index)
    },
    [page, scrollToSection],
  )

  return (
    <div class="welcome-hello">
      <div ref={scrollerRef} class="welcome-hello__scroller">
        <section
          ref={bindSection(0)}
          class={`welcome-hello__section welcome-hello__section--hello${page === 0 ? '' : ' welcome-hello__section--peek'}`}
          onClick={(event) => onPeekClick(0, event)}
        >
          <div class="welcome-hello__panel">
            <p class="welcome-hello__step">1 / {SECTION_COUNT}</p>
            <span class="welcome-hello__mark" aria-hidden="true">
              <InstantLogoIcon size={52} />
            </span>
            <p class="welcome-hello__kicker">Instant OS</p>
            <h1 class="welcome-hello__hello">
              <span key={helloWord} class="welcome-hello__hello-word">
                {helloWord}
              </span>
            </h1>
            <p class="welcome-hello__lede">一台会写内容的电脑。</p>
          </div>
        </section>

        <section
          ref={bindSection(1)}
          class={`welcome-hello__section${page === 1 ? '' : ' welcome-hello__section--peek'}`}
          onClick={(event) => onPeekClick(1, event)}
        >
          <div class="welcome-hello__panel">
            <p class="welcome-hello__step">2 / {SECTION_COUNT}</p>
            <h1 class="welcome-hello__title">先知道三件事</h1>
            <ol class="welcome-hello__facts">
              {FACTS.map((fact, index) => (
                <li key={fact} class="welcome-hello__fact">
                  <span class="welcome-hello__fact-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <p>{fact}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          ref={bindSection(2)}
          class={`welcome-hello__section${page === 2 ? '' : ' welcome-hello__section--peek'}`}
          onClick={(event) => onPeekClick(2, event)}
        >
          <div class="welcome-hello__panel">
            <p class="welcome-hello__step">3 / {SECTION_COUNT}</p>
            {keyStatus === 'needs-key' ? (
              <>
                <h1 class="welcome-hello__title">有一把 API Key 就够</h1>
                <p class="welcome-hello__body">
                  去钥匙串加一家供应商，再拖到列表最上面。大约两分钟。没有 Key 也能先逛。
                </p>
                <div class="welcome-hello__actions">
                  <Button tone="primary" onClick={openKeychain}>
                    去钥匙串
                  </Button>
                  <Button onClick={() => scrollToSection(3)}>先逛逛</Button>
                </div>
              </>
            ) : keyStatus === 'needs-preferred' ? (
              <>
                <h1 class="welcome-hello__title">差一步</h1>
                <p class="welcome-hello__body">
                  钥匙已经加上了，但当前还在走共享通道。把它拖到钥匙串列表第一位。
                </p>
                <div class="welcome-hello__actions">
                  <Button tone="primary" onClick={openKeychain}>
                    去排一下
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h1 class="welcome-hello__title">已经接上了</h1>
                <p class="welcome-hello__body">要换模型，随时打开钥匙串。</p>
                <div class="welcome-hello__actions">
                  <Button onClick={openKeychain}>打开钥匙串</Button>
                </div>
              </>
            )}
          </div>
        </section>

        <section
          ref={bindSection(3)}
          class={`welcome-hello__section welcome-hello__section--last${page === 3 ? '' : ' welcome-hello__section--peek'}`}
          onClick={(event) => onPeekClick(3, event)}
        >
          <div class="welcome-hello__panel">
            <p class="welcome-hello__step">4 / {SECTION_COUNT}</p>
            <h1 class="welcome-hello__title">先打开一个</h1>
            <p class="welcome-hello__body">点哪扇门都行。关这个窗，桌面还在。</p>
            <div class="welcome-hello__cards">
              {FEATURED.map(({ appId, Icon, blurb }) => (
                <button
                  key={appId}
                  type="button"
                  class="welcome-hello__card"
                  onClick={() => openFeatured(appId)}
                >
                  <span class="welcome-hello__card-icon" aria-hidden="true">
                    <Icon size={48} />
                  </span>
                  <span class="welcome-hello__card-name">{itemLabel(appId)}</span>
                  <span class="welcome-hello__card-blurb">{blurb}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      <footer class="welcome-hello__footer">
        <div class="welcome-hello__dots" role="tablist" aria-label="向导步骤">
          {Array.from({ length: SECTION_COUNT }, (_, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              class={`welcome-hello__dot${index === page ? ' welcome-hello__dot--active' : ''}`}
              aria-selected={index === page}
              aria-label={`第 ${index + 1} 步`}
              onClick={() => scrollToSection(index)}
            />
          ))}
        </div>
        <div class="welcome-hello__nav">
          {page > 0 ? (
            <Button onClick={() => scrollToSection(page - 1)}>上一步</Button>
          ) : undefined}
          <Button tone="primary" onClick={lastPage ? finish : () => scrollToSection(page + 1)}>
            {lastPage ? '开始使用' : '继续'}
          </Button>
        </div>
      </footer>
    </div>
  )
}
