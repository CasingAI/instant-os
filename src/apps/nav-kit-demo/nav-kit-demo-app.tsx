import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'preact/hooks'
import { useOs } from '../../os/os-context.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import { Button } from '../../ui/button.tsx'
import { PageButtonGroup } from '../../ui/page-button-group.tsx'
import { PageActionButton } from '../../ui/page-action-button.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import {
  AdaptiveSplitNav,
  useAdaptiveSplitNav,
  type AdaptiveSplitNavPageContext,
} from '../../ui/adaptive-split-nav.tsx'
import { NAV_KIT_DEMO_BOOKS, totalChapters, totalSections } from './nav-kit-demo-content.ts'
import './nav-kit-demo.css'
// SettingsNavRow 的行样式随 settings 应用样式表分发（ui-kit 组件 demo 同款用法）
import '../settings/settings.css'

type DemoPageId = string

const ROOT: DemoPageId = 'shelf'

/**
 * 领域位置：窄屏子页与分栏右栏帧共同的唯一真源。
 * 帧与页的 id 复用同一套 pageId 函数，两种形态渲染同一份 pane 内容。
 */
type Pos =
  | { kind: 'shelf' }
  | { kind: 'book'; b: number }
  | { kind: 'volume'; b: number; v: number }
  | { kind: 'chapter'; b: number; v: number | null; c: number }
  | { kind: 'section'; b: number; v: number | null; c: number; s: number }
  | { kind: 'about'; b: number }

function bookPage(index: number): DemoPageId {
  return `book:${index}`
}
function volumePage(book: number, volume: number): DemoPageId {
  return `volume:${book}:${volume}`
}
function chapterPage(book: number, volume: number | null, chapter: number): DemoPageId {
  return `chapter:${book}:${volume ?? '-'}:${chapter}`
}
function sectionPage(book: number, volume: number | null, chapter: number, section: number): DemoPageId {
  return `section:${book}:${volume ?? '-'}:${chapter}:${section}`
}
function aboutPage(book: number): DemoPageId {
  return `about:${book}`
}

function posPageId(pos: Pos): DemoPageId {
  switch (pos.kind) {
    case 'shelf':
      return ROOT
    case 'book':
      return bookPage(pos.b)
    case 'volume':
      return volumePage(pos.b, pos.v)
    case 'chapter':
      return chapterPage(pos.b, pos.v, pos.c)
    case 'section':
      return sectionPage(pos.b, pos.v, pos.c, pos.s)
    case 'about':
      return aboutPage(pos.b)
  }
}

function parentPos(pos: Pos): Pos | null {
  switch (pos.kind) {
    case 'shelf':
      return null
    case 'book':
      return { kind: 'shelf' }
    case 'about':
      return { kind: 'book', b: pos.b }
    case 'volume':
      return { kind: 'book', b: pos.b }
    case 'chapter':
      return pos.v === null ? { kind: 'book', b: pos.b } : { kind: 'volume', b: pos.b, v: pos.v }
    case 'section':
      return { kind: 'chapter', b: pos.b, v: pos.v, c: pos.c }
  }
}

/** 分栏右栏帧路径：从书帧到当前层（书架是左栏，不进帧栈） */
function framePositions(pos: Pos): Pos[] {
  const path: Pos[] = []
  let current: Pos | null = pos
  while (current && current.kind !== 'shelf') {
    path.unshift(current)
    current = parentPos(current)
  }
  return path
}

function parseBook(id: DemoPageId): number | null {
  const m = /^book:(\d+)$/.exec(id)
  return m ? Number(m[1]) : null
}
function parseVolume(id: DemoPageId): [number, number] | null {
  const m = /^volume:(\d+):(\d+)$/.exec(id)
  return m ? [Number(m[1]), Number(m[2])] : null
}
function parseChapter(id: DemoPageId): [number, number | null, number] | null {
  const m = /^chapter:(\d+):(-|\d+):(\d+)$/.exec(id)
  return m ? [Number(m[1]), m[2] === '-' ? null : Number(m[2]), Number(m[3])] : null
}
function parseSection(id: DemoPageId): [number, number | null, number, number] | null {
  const m = /^section:(\d+):(-|\d+):(\d+):(\d+)$/.exec(id)
  return m
    ? [Number(m[1]), m[2] === '-' ? null : Number(m[2]), Number(m[3]), Number(m[4])]
    : null
}
function parseAbout(id: DemoPageId): number | null {
  const m = /^about:(\d+)$/.exec(id)
  return m ? Number(m[1]) : null
}

export function NavKitDemoApp() {
  const { setAppWindowTitle } = useOs()
  useAppMenuBar('nav-kit-demo', [])

  useEffect(() => {
    setAppWindowTitle('nav-kit-demo', '导航组件演示')
  }, [setAppWindowTitle])

  const [pos, setPos] = useState<Pos>({ kind: 'shelf' })
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set())
  const [readChapters, setReadChapters] = useState<ReadonlySet<string>>(new Set())

  const nav = useAdaptiveSplitNav({
    split: true,
    narrowPageForState: () => posPageId(pos),
    // 分栏左栏显示的根列表页（书架）——与窄屏根页同一份渲染
    listPage: ROOT,
  })

  // 分栏右栏不空屏：书架位自动展开第一本书（与注册表选中首个命名空间同理）
  useEffect(() => {
    if (!nav.layoutReady || nav.narrowLayout) return
    if (pos.kind !== 'shelf') return
    setPos({ kind: 'book', b: 0 })
  }, [nav.layoutReady, nav.narrowLayout, pos.kind])

  const toggleFavorite = useCallback(
    (key: string) => {
      setFavorites((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [],
  )

  const toggleRead = useCallback(
    (key: string) => {
      setReadChapters((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [],
  )

  /** 打开一个层级：子页栈形态 push 对应页；分栏形态直接改状态（帧自动派生） */
  const openPos = useCallback(
    (next: Pos) => {
      setPos(next)
      nav.navigate(posPageId(next), 'push')
    },
    [nav],
  )

  /** 返回上级：子页栈 pop 动画结束后提交；分栏直接提交（旧帧保帧滑出） */
  const backPos = useCallback(() => {
    const parent = parentPos(pos)
    if (!parent) return
    nav.navigate(posPageId(parent), 'pop', () => setPos(parent))
  }, [nav, pos])

  // 宽→窄形变落定交棒：窄屏书页的「书架」返回此刻才无中生有（分栏没有
  // 这颗键），给一次透明度 0→1 的短淡入代替硬蹦；只挂落定时栈顶那页，
  // 播完即撤，不影响之后的正常进退。拖拽即时切同样走这里：翻转当帧
  // morphing 被标亮又被即时路径收掉，监听到同样的真→假。reduced-motion
  // 下 morphing 恒为假，淡入天然不触发。必须用 layout effect：类要在面板
  // 移除的同一帧 paint 前挂上，否则返回键先硬蹦一帧再从 0 重淡入。
  const [backFadeEpoch, setBackFadeEpoch] = useState(0)
  const backFadeTimerRef = useRef(0)
  const prevMorphingRef = useRef(false)
  useLayoutEffect(() => {
    const was = prevMorphingRef.current
    prevMorphingRef.current = nav.morphing
    if (was === nav.morphing) return
    if (nav.morphing || !nav.narrowLayout || pos.kind !== 'book') return
    window.clearTimeout(backFadeTimerRef.current)
    // epoch 递增 + 双类名交替：320ms 内背靠背再触发也能重播动画
    setBackFadeEpoch((epoch) => epoch + 1)
    backFadeTimerRef.current = window.setTimeout(() => setBackFadeEpoch(0), 320)
  }, [nav.morphing, nav.narrowLayout, pos.kind])
  useEffect(() => () => window.clearTimeout(backFadeTimerRef.current), [])

  // ── 内容渲染：同一份 pane 同时供给窄屏子页与分栏帧（showBack 控制返回键）──
  const renderShelf = () => (
    <Page
      header={<PageHeader title="书架" />}
    >
      <div class="nav-kit-demo__rows">
        <div class="settings__list">
          {NAV_KIT_DEMO_BOOKS.map((book, b) => (
            <SettingsNavRow
              key={book.id}
              label={book.title}
              value={`${book.author} · ${book.volumes ? `${book.volumes.length} 卷 · ` : ''}${totalChapters(book)} 章 · ${totalSections(book)} 节`}
              onClick={() => openPos({ kind: 'book', b })}
            />
          ))}
        </div>
      </div>
    </Page>
  )

  const renderBook = (b: number, showBack: boolean, headerClass?: string) => {
    const book = NAV_KIT_DEMO_BOOKS[b]
    if (!book) return renderShelf()
    const favKey = `book:${book.id}`
    const isFav = favorites.has(favKey)
    return (
      <Page
        header={
          <PageHeader
            class={headerClass}
            title={book.title}
            backLabel={showBack ? '书架' : undefined}
            onBack={showBack ? backPos : undefined}
            actions={
              <Button
                size="compact"
                tone={isFav ? 'primary' : 'secondary'}
                onClick={() => toggleFavorite(favKey)}
              >
                收藏
              </Button>
            }
          />
        }
      >
        <p class="nav-kit-demo__intro">{book.intro}</p>
        <div class="nav-kit-demo__rows">
          <div class="settings__list">
            {book.volumes
              ? book.volumes.map((volume, v) => (
                  <SettingsNavRow
                    key={volume.title}
                    label={volume.title}
                    value={`${volume.chapters.length} 章 · ${volume.chapters.reduce(
                      (sum, ch) => sum + ch.sections.length,
                      0,
                    )} 节`}
                    onClick={() => openPos({ kind: 'volume', b, v })}
                  />
                ))
              : book.chapters.map((chapter, c) => (
                  <SettingsNavRow
                    key={chapter.title}
                    label={chapter.title}
                    value={`${chapter.sections.length} 节`}
                    onClick={() => openPos({ kind: 'chapter', b, v: null, c })}
                  />
                ))}
            <SettingsNavRow
              label="关于本书"
              value="版本信息"
              onClick={() => openPos({ kind: 'about', b })}
            />
          </div>
        </div>
      </Page>
    )
  }

  const renderVolume = (b: number, v: number, showBack: boolean) => {
    const book = NAV_KIT_DEMO_BOOKS[b]
    const volume = book?.volumes?.[v]
    if (!book || !volume) return renderShelf()
    return (
      <Page
        header={
          <PageHeader
            title={volume.title}
            backLabel={showBack ? book.title : undefined}
            onBack={showBack ? backPos : undefined}
          />
        }
      >
        <div class="nav-kit-demo__rows">
          <div class="settings__list">
            {volume.chapters.map((chapter, c) => (
              <SettingsNavRow
                key={chapter.title}
                label={chapter.title}
                value={`${chapter.sections.length} 节`}
                onClick={() => openPos({ kind: 'chapter', b, v, c })}
              />
            ))}
          </div>
        </div>
      </Page>
    )
  }

  const renderChapter = (b: number, v: number | null, c: number, showBack: boolean) => {
    const book = NAV_KIT_DEMO_BOOKS[b]
    if (!book) return renderShelf()
    const chapter = v === null ? book.chapters[c] : book.volumes?.[v]?.chapters[c]
    if (!chapter) return renderShelf()
    const parentLabel = v === null ? book.title : (book.volumes?.[v]?.title ?? book.title)
    const favKey = `chapter:${book.id}:${chapter.title}`
    const readKey = `read:${book.id}:${chapter.title}`
    const isFav = favorites.has(favKey)
    const isRead = readChapters.has(readKey)
    return (
      <Page
        header={
          <PageHeader
            title={chapter.title}
            backLabel={showBack ? parentLabel : undefined}
            onBack={showBack ? backPos : undefined}
            actions={
              <PageButtonGroup>
                <PageActionButton activated={isFav} onClick={() => toggleFavorite(favKey)}>
                  收藏
                </PageActionButton>
                <PageActionButton activated={isRead} onClick={() => toggleRead(readKey)}>
                  标记已读
                </PageActionButton>
                <PageActionButton>分享</PageActionButton>
                <PageActionButton>导出备份</PageActionButton>
              </PageButtonGroup>
            }
          />
        }
      >
        <div class="nav-kit-demo__rows">
          <div class="settings__list">
            {chapter.sections.map((section, s) => (
              <SettingsNavRow
                key={section.title}
                label={section.title}
                value=""
                onClick={() => openPos({ kind: 'section', b, v, c, s })}
              />
            ))}
          </div>
        </div>
      </Page>
    )
  }

  const renderSection = (b: number, v: number | null, c: number, s: number, showBack: boolean) => {
    const book = NAV_KIT_DEMO_BOOKS[b]
    if (!book) return renderShelf()
    const chapter = v === null ? book.chapters[c] : book.volumes?.[v]?.chapters[c]
    const section = chapter?.sections[s]
    if (!chapter || !section) return renderShelf()
    return (
      <Page
        header={
          <PageHeader
            title={section.title}
            backLabel={showBack ? chapter.title : undefined}
            onBack={showBack ? backPos : undefined}
          />
        }
      >
        <p class="nav-kit-demo__intro">{book.title} · {chapter.title}</p>
        {section.paragraphs.map((paragraph, i) => (
          <p key={i} class="nav-kit-demo__paragraph">
            {paragraph}
          </p>
        ))}
        <ul class="nav-kit-demo__bullets">
          {section.bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      </Page>
    )
  }

  const renderAbout = (b: number, showBack: boolean) => {
    const book = NAV_KIT_DEMO_BOOKS[b]
    if (!book) return renderShelf()
    const favKey = `book:${book.id}`
    const readKey = `read:book:${book.id}`
    const isFav = favorites.has(favKey)
    const isRead = readChapters.has(readKey)
    return (
      <Page
        header={
          <PageHeader
            /* 无标题页面：三槽只剩返回与操作，标题位留空 */
            backLabel={showBack ? book.title : undefined}
            onBack={showBack ? backPos : undefined}
            actions={
              <PageButtonGroup>
                <PageActionButton activated={isFav} onClick={() => toggleFavorite(favKey)}>
                  收藏
                </PageActionButton>
                <PageActionButton activated={isRead} onClick={() => toggleRead(readKey)}>
                  标记已读
                </PageActionButton>
                <PageActionButton>分享</PageActionButton>
                <PageActionButton>导出备份</PageActionButton>
              </PageButtonGroup>
            }
          />
        }
      >
        <p class="nav-kit-demo__intro">{book.intro}</p>
        <ul class="nav-kit-demo__meta">
          <li>作者　{book.author}</li>
          <li>
            结构　{book.volumes ? `${book.volumes.length} 卷 · ` : ''}
            {totalChapters(book)} 章 · {totalSections(book)} 节
          </li>
          <li>版本　1.0</li>
          <li>书号　{book.id.toUpperCase()}-DEMO-001</li>
        </ul>
      </Page>
    )
  }

  // flat 引擎：每页 id 只有一个常驻 host，窄屏子页与分栏帧是同一实例的
  // 两种角色——渲染分发只有一份，chrome 按 ctx（形态 + 形变分型）现场决定。
  const framePath = framePositions(pos)
  const frames = framePath.map(posPageId)
  const topFrameId = frames.length > 0 ? frames[frames.length - 1] : ''

  const renderPage = (target: DemoPageId, ctx: AdaptiveSplitNavPageContext) => {
    const bookIdx = parseBook(target)
    if (bookIdx !== null) {
      // 「书架」返回只有书页处在子页栈角色（窄屏）里才有：分栏静置的书帧
      // 没有——它的上级书架是左栏。形变盖住画面的是这一份实例，chrome 按
      // 起始形态画：A 型（窄→宽）滑轨的顶帧挂着返回随滑轨淡出（滑轨的退出
      // 方向就是这颗键的消失方向）；C 型（宽→窄）面板不带返回——书架由
      // 滑轨盖过去，返回键等形变落定、交棒给子页栈后才由 backFadeEpoch
      // 淡入。其余层级两种形态都有返回，恒挂。
      const showBack = !ctx.narrowLayout
        ? ctx.morphing &&
          ctx.morphKind === 'A' &&
          target === topFrameId &&
          pos.kind === 'book'
        : !(ctx.morphing && ctx.morphKind === 'C')
      const fadingOut = !ctx.narrowLayout && showBack
      const fadingIn =
        ctx.narrowLayout && backFadeEpoch > 0 && target === nav.page
      return renderBook(
        bookIdx,
        showBack,
        fadingOut
          ? 'nav-kit-demo__back-fade-out'
          : fadingIn
            ? `nav-kit-demo__back-fade-in-${backFadeEpoch % 2}`
            : undefined,
      )
    }
    const vol = parseVolume(target)
    if (vol) return renderVolume(vol[0], vol[1], true)
    const chap = parseChapter(target)
    if (chap) return renderChapter(chap[0], chap[1], chap[2], true)
    const sec = parseSection(target)
    if (sec) return renderSection(sec[0], sec[1], sec[2], sec[3], true)
    const about = parseAbout(target)
    if (about !== null) return renderAbout(about, true)
    return renderShelf()
  }

  return (
    <AdaptiveSplitNav
      controller={nav}
      engine="flat"
      frames={frames}
      renderPage={renderPage}
      framesResetKey={pos.kind === 'shelf' ? 'shelf' : `b:${pos.b}`}
    />
  )
}
