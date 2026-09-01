import type { JSX } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { useOs } from '../../os/os-context.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { usePageStack, PageStack } from '../../ui/page-stack.tsx'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import { PageActionButton } from '../../ui/page-action-button.tsx'
import { PageButtonGroup } from '../../ui/page-button-group.tsx'
import { NAV_KIT_DEMO_BOOKS, totalChapters, totalSections } from './nav-kit-demo-content.ts'
import './nav-kit-demo.css'

type DemoPageId = string

const ROOT: DemoPageId = 'shelf'

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
  const { page, stack, transition, navigate, handleMotionEnd } =
    usePageStack<DemoPageId>(ROOT)

  useAppMenuBar('nav-kit-demo', [])

  useEffect(() => {
    setAppWindowTitle('nav-kit-demo', '导航组件演示')
  }, [setAppWindowTitle])

  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set())
  const [readChapters, setReadChapters] = useState<ReadonlySet<string>>(new Set())

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

  const renderShelf = () => (
    <Page
      header={<PageHeader title="书架" />}
    >
      {NAV_KIT_DEMO_BOOKS.map((book, b) => (
        <NavRow
          key={book.id}
          label={book.title}
          sub={`${book.author} · ${book.volumes ? `${book.volumes.length} 卷 · ` : ''}${totalChapters(book)} 章 · ${totalSections(book)} 节`}
          onClick={() => navigate(bookPage(b), 'push')}
        />
      ))}
    </Page>
  )

  const renderBook = (b: number) => {
    const book = NAV_KIT_DEMO_BOOKS[b]
    if (!book) return renderShelf()
    const favKey = `book:${book.id}`
    const isFav = favorites.has(favKey)
    return (
      <Page
        header={
          <PageHeader
            title={book.title}
            backLabel="书架"
            onBack={() => navigate(ROOT, 'pop')}
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
                onClick={() => navigate(volumePage(b, v), 'push')}
              />
            ))
          : book.chapters.map((chapter, c) => (
              <NavRow
                key={chapter.title}
                label={chapter.title}
                sub={`${chapter.sections.length} 节`}
                onClick={() => navigate(chapterPage(b, null, c), 'push')}
              />
            ))}
        <NavRow
          label="关于本书"
          sub="版本信息"
          onClick={() => navigate(aboutPage(b), 'push')}
        />
      </Page>
    )
  }

  const renderVolume = (b: number, v: number) => {
    const book = NAV_KIT_DEMO_BOOKS[b]
    const volume = book?.volumes?.[v]
    if (!book || !volume) return renderShelf()
    return (
      <Page
        header={
          <PageHeader
            title={volume.title}
            backLabel={book.title}
            onBack={() => navigate(bookPage(b), 'pop')}
          />
        }
      >
        {volume.chapters.map((chapter, c) => (
          <NavRow
            key={chapter.title}
            label={chapter.title}
            sub={`${chapter.sections.length} 节`}
            onClick={() => navigate(chapterPage(b, v, c), 'push')}
          />
        ))}
      </Page>
    )
  }

  const renderChapter = (b: number, v: number | null, c: number) => {
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
            backLabel={parentLabel}
            onBack={() =>
              navigate(
                v === null ? bookPage(b) : volumePage(b, v),
                'pop',
              )
            }
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
            onClick={() => navigate(sectionPage(b, v, c, s), 'push')}
          />
        ))}
      </Page>
    )
  }

  const renderSection = (b: number, v: number | null, c: number, s: number) => {
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
            backLabel={chapter.title}
            onBack={() => navigate(chapterPage(b, v, c), 'pop')}
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

  const renderAbout = (b: number) => {
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
            backLabel={book.title}
            onBack={() => navigate(bookPage(b), 'pop')}
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

  return (
    <PageStack
      stack={stack}
      page={page}
      transition={transition}
      onMotionEnd={handleMotionEnd}
      renderPage={(target) => {
        const bookIdx = parseBook(target)
        if (bookIdx !== null) return renderBook(bookIdx)
        const vol = parseVolume(target)
        if (vol) return renderVolume(vol[0], vol[1])
        const chap = parseChapter(target)
        if (chap) return renderChapter(chap[0], chap[1], chap[2])
        const sec = parseSection(target)
        if (sec) return renderSection(sec[0], sec[1], sec[2], sec[3])
        const about = parseAbout(target)
        if (about !== null) return renderAbout(about)
        return renderShelf()
      }}
    />
  )
}