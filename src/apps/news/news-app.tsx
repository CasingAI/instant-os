import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { generateArticlesForDateStreaming } from './news-agent.ts'
import {
  formatShortEditionDate,
  getTodayEditionDate,
  NewsDatePicker,
  shiftEditionDate,
} from './news-date-picker.tsx'
import {
  addArticles,
  assignArticleListPositions,
  formatEditionDateLabel,
  getArticlesForDate,
  readNewsStore,
} from './news-storage.ts'
import { NewsCommentsSection } from './news-comments-section.tsx'
import type { NewsArticle, NewsStore } from './news-types.ts'
import './news.css'

const READER_PLACEHOLDERS = [
  { headline: '今日新闻，好心情', subline: '在左侧选一篇报道，慢慢品读' },
  { headline: '阅尽天下事', subline: '暂且落座，等风也等字' },
  { headline: '纸短情长', subline: '每一条快讯，都是虚构世界的一页' },
  { headline: '晨间简报', subline: '泡杯茶，挑一篇感兴趣的' },
  { headline: '午后闲读', subline: '新闻会自己冒出来，你只管点开' },
  { headline: '晚报时光', subline: '今日版面已铺开，等你翻阅' },
] as const

function pickReaderPlaceholder(editionDate: string) {
  const seed = editionDate.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return READER_PLACEHOLDERS[seed % READER_PLACEHOLDERS.length]
}

function NewsLoadingState() {
  return (
    <div class="news__loading" role="status" aria-live="polite">
      <div class="news__loading-spinner" aria-hidden="true" />
      <p>正在加载中</p>
    </div>
  )
}

function NewsReaderPlaceholder({ editionDate }: { editionDate: string }) {
  const copy = useMemo(() => pickReaderPlaceholder(editionDate), [editionDate])

  return (
    <div class="news__reader-placeholder" aria-hidden="true">
      <div class="news__reader-placeholder-watermark">NEWS</div>
      <div class="news__reader-placeholder-content">
        <span class="news__reader-placeholder-icon">📰</span>
        <p class="news__reader-placeholder-headline">{copy.headline}</p>
        <p class="news__reader-placeholder-subline">{copy.subline}</p>
      </div>
    </div>
  )
}

export function NewsApp() {
  const { setAppWindowTitle, closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const [store, setStore] = useState<NewsStore>(() => readNewsStore())
  const [editionDate, setEditionDate] = useState<string>(() => getTodayEditionDate())
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [isGenerating, setIsGenerating] = useState(false)
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(() => new Set())
  const [streamingArticleIds, setStreamingArticleIds] = useState<string[]>([])
  const [baselineArticleIds, setBaselineArticleIds] = useState<string[]>([])
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  const articlesForDay = useMemo(() => getArticlesForDate(store, editionDate), [store, editionDate])

  const streamingArticles = useMemo(() => {
    if (!isGenerating) return []
    const byId = new Map(articlesForDay.map((article) => [article.id, article]))
    return streamingArticleIds
      .map((id) => byId.get(id))
      .filter((article): article is NewsArticle => article !== undefined)
  }, [articlesForDay, isGenerating, streamingArticleIds])

  const baselineArticles = useMemo(() => {
    if (!isGenerating) return []
    const byId = new Map(articlesForDay.map((article) => [article.id, article]))
    return baselineArticleIds
      .map((id) => byId.get(id))
      .filter((article): article is NewsArticle => article !== undefined)
  }, [articlesForDay, baselineArticleIds, isGenerating])

  const listArticles = useMemo(() => {
    if (!isGenerating) {
      return articlesForDay
    }
    return [...streamingArticles, ...baselineArticles]
  }, [articlesForDay, isGenerating, streamingArticles, baselineArticles])

  const selectedArticle = useMemo(() => {
    if (!selectedId) {
      return undefined
    }
    return listArticles.find((article) => article.id === selectedId)
  }, [listArticles, selectedId])

  useEffect(() => {
    setAppWindowTitle('news', '新闻')
  }, [setAppWindowTitle])

  // 响应来自系统设置的删除等外部变更，立即同步本地状态
  useEffect(() => {
    const onChanged = () => {
      setStore(readNewsStore())
    }
    window.addEventListener('instant-os:news-store-changed', onChanged)
    return () => {
      window.removeEventListener('instant-os:news-store-changed', onChanged)
    }
  }, [])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const handlePrevDay = useCallback(() => {
    setEditionDate(shiftEditionDate(editionDate, -1))
    setSelectedId(undefined)
    setDatePickerOpen(false)
  }, [editionDate])

  const handleNextDay = useCallback(() => {
    setEditionDate(shiftEditionDate(editionDate, 1))
    setSelectedId(undefined)
    setDatePickerOpen(false)
  }, [editionDate])

  const handleJumpToToday = useCallback(() => {
    setEditionDate(getTodayEditionDate())
    setSelectedId(undefined)
    setDatePickerOpen(false)
  }, [])

  const handleDateSelect = useCallback((value: string) => {
    setEditionDate(value)
    setSelectedId(undefined)
    setDatePickerOpen(false)
  }, [])

  const markArticleEntering = useCallback((articleId: string) => {
    setEnteringIds((current) => {
      const next = new Set(current)
      next.add(articleId)
      return next
    })
    window.setTimeout(() => {
      setEnteringIds((current) => {
        if (!current.has(articleId)) {
          return current
        }
        const next = new Set(current)
        next.delete(articleId)
        return next
      })
    }, 400)
  }, [])

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return
    const baseline = getArticlesForDate(readNewsStore(), editionDate).map((article) => article.id)
    setBaselineArticleIds(baseline)
    setStreamingArticleIds([])
    setIsGenerating(true)
    const newArticleIdsInOrder: string[] = []
    try {
      let fresh = readNewsStore()
      const seenTitles = new Set(getArticlesForDate(fresh, editionDate).map((article) => article.title))

      await generateArticlesForDateStreaming(editionDate, (article) => {
        if (seenTitles.has(article.title)) {
          return
        }
        seenTitles.add(article.title)
        fresh = addArticles(fresh, [article])
        newArticleIdsInOrder.push(article.id)
        setStore({ ...fresh })
        setStreamingArticleIds([...newArticleIdsInOrder])
        markArticleEntering(article.id)
      })

      if (newArticleIdsInOrder.length > 0) {
        fresh = assignArticleListPositions(fresh, editionDate, newArticleIdsInOrder, baseline)
        setStore({ ...fresh })
      }
    } finally {
      setIsGenerating(false)
      setStreamingArticleIds([])
      setBaselineArticleIds([])
    }
  }, [editionDate, isGenerating, markArticleEntering])

  useEffect(() => {
    setStreamingArticleIds([])
    setBaselineArticleIds([])
  }, [editionDate])

  // 日期切换后，若当前日期尚无任何新闻，则自动触发生成（不再依赖显式按钮）
  useEffect(() => {
    if (articlesForDay.length === 0 && !isGenerating) {
      void handleGenerate()
    }
  }, [articlesForDay.length, isGenerating, editionDate, handleGenerate])

  useEffect(() => {
    if (!selectedId) {
      return
    }
    if (listArticles.length === 0 || !listArticles.some((article) => article.id === selectedId)) {
      setSelectedId(undefined)
    }
  }, [listArticles, selectedId])

  const menuBar = useMemo((): MenuDefinition[] => {
    const win = windows.find((w) => w.appId === 'news' && !w.minimized)
    return [
      {
        label: '新闻',
        items: [
          ...aboutAppMenuPrefix('关于 新闻', () => showBuiltinAbout('news')),
          {
            type: 'action',
            label: '隐藏新闻',
            shortcut: '⌘H',
            onClick: () => win && minimizeWindow(win.id),
          },
          { type: 'separator' },
          { type: 'action', label: '退出新闻', shortcut: '⌘Q', onClick: () => closeWindowsForApp('news') },
        ],
      },
      {
        label: '日期',
        items: [
          { type: 'action', label: '前一天', shortcut: '⌘←', onClick: handlePrevDay },
          { type: 'action', label: '后一天', shortcut: '⌘→', onClick: handleNextDay },
          { type: 'separator' },
          { type: 'action', label: '回到今天', onClick: handleJumpToToday },
        ],
      },
    ]
  }, [
    closeWindowsForApp,
    handleJumpToToday,
    handleNextDay,
    handlePrevDay,
    minimizeWindow,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar('news', menuBar)

  const dateLabel = formatEditionDateLabel(editionDate)
  const shortPrev = formatShortEditionDate(shiftEditionDate(editionDate, -1))
  const shortNext = formatShortEditionDate(shiftEditionDate(editionDate, 1))

  function renderNewsRow(article: NewsArticle, idx: number) {
    const isActive = article.id === selectedId
    const isEntering = enteringIds.has(article.id)
    return (
      <button
        key={article.id}
        type="button"
        class={`news__row ${isActive ? 'news__row--active' : ''} ${idx === 0 && !isGenerating ? 'news__row--featured' : ''}${isEntering ? ' news__row--enter' : ''}`}
        onClick={() => handleSelect(article.id)}
      >
        <div class="news__row-meta">
          <span class="news__row-cat">{article.category}</span>
          {article.source && <span class="news__row-src">{article.source}</span>}
        </div>
        <div class="news__row-title">{article.title}</div>
        <div class="news__row-lead">{article.lead}</div>
      </button>
    )
  }

  return (
    <div class="news">
      <header class="news__toolbar">
        <div class="news__toolbar-left">
          <span class="news__brand">新闻</span>
        </div>

        <div class="news__date-control">
          <button
            type="button"
            class="news__date-nav"
            onClick={handlePrevDay}
            aria-label="前一天"
            title={`前一天 ${shortPrev}`}
          >
            ‹
          </button>
          <button
            type="button"
            class="news__date-label"
            onClick={() => setDatePickerOpen(true)}
            aria-expanded={datePickerOpen}
          >
            {dateLabel}
            <span class="news__date-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          <button
            type="button"
            class="news__date-nav"
            onClick={handleNextDay}
            aria-label="后一天"
            title={`后一天 ${shortNext}`}
          >
            ›
          </button>
        </div>

      </header>

      <NewsDatePicker
        open={datePickerOpen}
        value={editionDate}
        onSelect={handleDateSelect}
        onClose={() => setDatePickerOpen(false)}
      />

      <div class="news__body">
        <aside class="news__list">
          <div class="news__list-header">
            <span class="news__list-header-label">报道</span>
            {!isGenerating && (
              <button
                type="button"
                class="news__refresh-btn"
                onClick={() => void handleGenerate()}
                title="加载更多当天新闻（新生成的会显示在列表前面）"
                aria-label="刷新加载更多"
              >
                ↻
              </button>
            )}
          </div>
          {listArticles.length === 0 ? (
            isGenerating ? (
              <NewsLoadingState />
            ) : (
              <div class="news__empty-list">
                <div class="news__empty-icon" aria-hidden="true">
                  🗞️
                </div>
                <p>这一天还没有新闻</p>
              </div>
            )
          ) : (
            isGenerating ? (
              <>
                {streamingArticles.map((article, idx) => renderNewsRow(article, idx))}
                <div class="news__list-skeleton" aria-hidden="true" />
                {baselineArticles.map((article, idx) => renderNewsRow(article, idx))}
              </>
            ) : (
              listArticles.map((article, idx) => renderNewsRow(article, idx))
            )
          )}
        </aside>

        <section class="news__reader">
          {selectedArticle ? (
            <article class="news__article">
              <header class="news__article-head">
                <div class="news__article-meta">
                  <span class="news__article-cat">{selectedArticle.category}</span>
                  <span class="news__article-date">{dateLabel}</span>
                  {selectedArticle.source && <span class="news__article-src">· {selectedArticle.source}</span>}
                </div>
                <h1 class="news__article-title">{selectedArticle.title}</h1>
                <p class="news__article-lead">{selectedArticle.lead}</p>
              </header>

              <div class="news__article-body">
                {selectedArticle.body
                  .split('\n')
                  .filter((p) => p.trim().length > 0)
                  .map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
              </div>

              <NewsCommentsSection
                article={selectedArticle}
                store={store}
                onStoreChange={setStore}
              />
            </article>
          ) : (
            <NewsReaderPlaceholder editionDate={editionDate} />
          )}
        </section>
      </div>
    </div>
  )
}