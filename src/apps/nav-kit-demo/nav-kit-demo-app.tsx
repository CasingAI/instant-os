import type { JSX } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { useOs } from '../../os/os-context.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import { PageActionButton } from '../../ui/page-action-button.tsx'
import { PageButtonGroup } from '../../ui/page-button-group.tsx'
import {
  AdaptiveSplitNav,
  useAdaptiveSplitNav,
  type AdaptiveFrameSpec,
} from '../../ui/adaptive-split-nav.tsx'
import { NAV_KIT_DEMO_BOOKS, totalChapters, totalSections } from './nav-kit-demo-content.ts'
import './nav-kit-demo.css'

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

/** 列表中「卷 / 章 / 节」的行 */
function NavRow({
  label,
  sub,
  onClick,
}: {
  label: string
  sub?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button type="button" class="nav-kit-demo__row" onClick={onClick}>
      <span class="nav-kit-demo__row-label">{label}</span>
      {sub ? <span class="nav-kit-demo__row-sub">{sub}</span> : undefined}
      <svg
        class="nav-kit-demo__row-chevron"
        width="10"
        height="16"
        viewBox="0 0 10 16"
        aria-hidden="true"
      >
        <path
          d="M2 2 L8 8 L2 14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  )
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

  // ── 内容渲染：同一份 pane 同时供给窄屏子页与分栏帧（showBack 控制返回键）──

  const renderShelf = () => (
    <Page
      header={<PageHeader title="书架" />}
    >
      {NAV_KIT_DEMO_BOOKS.map((book, b) => (
        <NavRow
          key={book.id}
          label={book.title}
          sub={`${book.author} · ${book.volumes ? `${book.volumes.length} 卷 · ` : ''}${totalChapters(book)} 章 · ${totalSections(book)} 节`}
          onClick={() => openPos({ kind: 'book', b })}
        />
      ))}
    </Page>
  )

  const renderBook = (b: number, showBack: boolean) => {
    const book = NAV_KIT_DEMO_BOOKS[b]
    if (!book) return renderShelf()
    const favKey = `book:${book.id}`
    const isFav = favorites.has(favKey)
    return (
      <Page
        header={
          <PageHeader
            title={book.title}
            backLabel={showBack ? '书架' : undefined}
            onBack={showBack ? backPos : undefined}
            actions={
              <PageActionButton
                activated={isFav}
                onClick={() => toggleFavorite(favKey)}
              >
                收藏
              </PageActionButton>
            }
          />
        }
      >
        <p class="nav-kit-demo__intro">{book.intro}</p>
        {book.volumes
          ? book.volumes.map((volume, v) => (
              <NavRow
                key={volume.title}
                label={volume.title}
                sub={`${volume.chapters.length} 章 · ${volume.chapters.reduce(
                  (sum, ch) => sum + ch.sections.length,
                  0,
                )} 节`}
                onClick={() => openPos({ kind: 'volume', b, v })}
              />
            ))
          : book.chapters.map((chapter, c) => (
              <NavRow
                key={chapter.title}
                label={chapter.title}
                sub={`${chapter.sections.length} 节`}
                onClick={() => openPos({ kind: 'chapter', b, v: null, c })}
              />
            ))}
        <NavRow
          label="关于本书"
          sub="版本信息"
          onClick={() => openPos({ kind: 'about', b })}
        />
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
        {volume.chapters.map((chapter, c) => (
          <NavRow
            key={chapter.title}
            label={chapter.title}
            sub={`${chapter.sections.length} 节`}
            onClick={() => openPos({ kind: 'chapter', b, v, c })}
          />
        ))}
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
                <PageActionButton
                  activated={isFav}
                  onClick={() => toggleFavorite(favKey)}
                >
                  收藏
                </PageActionButton>
                <PageActionButton
                  activated={isRead}
                  onClick={() => toggleRead(readKey)}
                >
                  标记已读
                </PageActionButton>
                <PageActionButton>分享</PageActionButton>
                <PageActionButton>导出备份</PageActionButton>
              </PageButtonGroup>
            }
          />
        }
      >
        {chapter.sections.map((section, s) => (
          <NavRow
            key={section.title}
            label={section.title}
            onClick={() => openPos({ kind: 'section', b, v, c, s })}
          />
        ))}
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
                <PageActionButton
                  activated={isFav}
                  onClick={() => toggleFavorite(favKey)}
                >
                  收藏
                </PageActionButton>
                <PageActionButton
                  activated={isRead}
                  onClick={() => toggleRead(readKey)}
                >
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

  // 子页栈：按页 id 分发（层保活，各页按自身实体渲染）
  const renderNarrowPage = (target: DemoPageId) => {
    const bookIdx = parseBook(target)
    if (bookIdx !== null) return renderBook(bookIdx, true)
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

  // 分栏帧：首帧（书帧）不带返回——它的上级书架是左栏；更深层都有父帧
  const renderFrameContent = (p: Pos) => {
    switch (p.kind) {
      case 'shelf':
        return renderShelf()
      case 'book':
        return renderBook(p.b, false)
      case 'volume':
        return renderVolume(p.b, p.v, true)
      case 'chapter':
        return renderChapter(p.b, p.v, p.c, true)
      case 'section':
        return renderSection(p.b, p.v, p.c, p.s, true)
      case 'about':
        return renderAbout(p.b, true)
    }
  }

  const renderWideFrames = (): AdaptiveFrameSpec[] =>
    framePositions(pos).map((p) => ({ id: posPageId(p), content: renderFrameContent(p) }))

  return (
    <AdaptiveSplitNav
      controller={nav}
      renderNarrowPage={renderNarrowPage}
      renderList={renderShelf}
      renderWideFrames={renderWideFrames}
      framesResetKey={pos.kind === 'shelf' ? 'shelf' : `b:${pos.b}`}
    />
  )
}
