import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { AiStreamPreview } from '../../ai/ai-stream-preview.tsx'
import type { SpeechBlock } from '../../ai/speech-read-aloud.ts'
import { useSpeechReadAloud } from '../../ai/use-speech-read-aloud.ts'
import { BackIcon, ForwardIcon, ReloadIcon } from '../../icons/app-icons.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SpeechReadAloudBar } from '../../ui/speech-read-aloud-bar.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
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
  formatEditionDateDetailLabel,
  getArticlesForDate,
  readNewsStore,
} from './news-storage.ts'
import { NewsCommentsSection } from './news-comments-section.tsx'
import {
  subscribeNewsEditionRequest,
  takePendingNewsEdition,
  type NewsEditionRequest,
} from './news-edition-request.ts'
import type { NewsArticle, NewsStore } from './news-types.ts'
import './news.css'

const NEWS_SPEECH_USAGE = {
  actor: 'news',
  behavior: 'read-aloud',
  behaviorLabel: '朗读',
} as const

function articleBodyParagraphs(body: string): string[] {
  return body
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
}

function articleToSpeechBlocks(article: NewsArticle): SpeechBlock[] {
  const blocks: SpeechBlock[] = []
  const title = article.title.trim()
  const lead = article.lead.trim()
  if (title) {
    blocks.push({ id: 'title', text: title })
  }
  if (lead) {
    blocks.push({ id: 'lead', text: lead })
  }
  articleBodyParagraphs(article.body).forEach((paragraph, index) => {
    blocks.push({ id: `body-${index}`, text: paragraph })
  })
  return blocks
}

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

function NewsListThinkingSkeleton({ reasoningText }: { reasoningText: string }) {
  return (
    <div class="news__list-skeleton news__list-skeleton--thinking" aria-hidden="true">
      {reasoningText ? (
        <AiStreamPreview
          reasoningText={reasoningText}
          variant="news-list"
          emptyLabel="正在思考…"
        />
      ) : (
        <div class="news__list-skeleton-pulse" />
      )}
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
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()

  const [store, setStore] = useState<NewsStore>(() => readNewsStore())
  const [editionDate, setEditionDate] = useState<string>(() => getTodayEditionDate())
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [stackedReaderOpen, setStackedReaderOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(() => new Set())
  const [streamingArticleIds, setStreamingArticleIds] = useState<string[]>([])
  const [baselineArticleIds, setBaselineArticleIds] = useState<string[]>([])
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [generationFailed, setGenerationFailed] = useState(false)
  const [reasoningText, setReasoningText] = useState('')
  const dayContextRef = useRef<string | undefined>()
  const skipAutoGenerateRef = useRef(false)
  const generateLockRef = useRef(false)
  const prevNarrowLayoutRef = useRef<boolean | undefined>(undefined)

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

  const readAloud = useSpeechReadAloud(NEWS_SPEECH_USAGE)
  const { close: closeReadAloud } = readAloud
  const speechBlocks = useMemo(
    () => (selectedArticle ? articleToSpeechBlocks(selectedArticle) : []),
    [selectedArticle],
  )
  const canStartSpeech = speechBlocks.length > 0

  useEffect(() => {
    closeReadAloud()
  }, [selectedId, closeReadAloud])

  const generatingFromEmpty = isGenerating && baselineArticleIds.length === 0
  const showReaderThinkingOverlay =
    generatingFromEmpty && !selectedArticle && streamingArticleIds.length === 0

  useEffect(() => {
    setAppWindowTitle('news', '新闻')
  }, [setAppWindowTitle])

  useEffect(() => {
    if (!layoutReady) {
      return
    }

    const previous = prevNarrowLayoutRef.current
    if (previous === undefined) {
      // 首次测量：窄屏从列表开始，不把「默认宽 → 实测窄」当成缩窗
      prevNarrowLayoutRef.current = narrowLayout
      return
    }

    prevNarrowLayoutRef.current = narrowLayout

    // 宽屏缩到窄屏时，若当前有选中项，保持详情页而不是退回列表
    if (!previous && narrowLayout && selectedId !== undefined) {
      setStackedReaderOpen(true)
      return
    }

    if (!narrowLayout) {
      setStackedReaderOpen(false)
    }
  }, [layoutReady, narrowLayout, selectedId])

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

  const clearStackedReader = useCallback(() => {
    setStackedReaderOpen(false)
    setSelectedId(undefined)
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

  const handleGenerate = useCallback(
    async (options?: { targetDate?: string; dayContext?: string }) => {
      if (generateLockRef.current) {
        return
      }
      const targetDate = options?.targetDate ?? editionDate
      const dayContext = options?.dayContext ?? dayContextRef.current
      generateLockRef.current = true
      setGenerationFailed(false)
      setReasoningText('')
      const baseline = getArticlesForDate(readNewsStore(), targetDate).map((article) => article.id)
      setBaselineArticleIds(baseline)
      setStreamingArticleIds([])
      setIsGenerating(true)
      const newArticleIdsInOrder: string[] = []
      try {
        let fresh = readNewsStore()
        const seenTitles = new Set(
          getArticlesForDate(fresh, targetDate).map((article) => article.title),
        )

        await generateArticlesForDateStreaming(
          targetDate,
          (article) => {
            if (seenTitles.has(article.title)) {
              return
            }
            seenTitles.add(article.title)
            fresh = addArticles(fresh, [article])
            newArticleIdsInOrder.push(article.id)
            setStore({ ...fresh })
            setStreamingArticleIds([...newArticleIdsInOrder])
            markArticleEntering(article.id)
          },
          {
            dayContext,
            onReasoning: setReasoningText,
          },
        )

        if (newArticleIdsInOrder.length > 0) {
          fresh = assignArticleListPositions(fresh, targetDate, newArticleIdsInOrder, baseline)
          setStore({ ...fresh })
        } else {
          setGenerationFailed(true)
        }
      } catch {
        setGenerationFailed(true)
      } finally {
        generateLockRef.current = false
        setIsGenerating(false)
        setStreamingArticleIds([])
        setBaselineArticleIds([])
        setReasoningText('')
        dayContextRef.current = undefined
      }
    },
    [editionDate, markArticleEntering],
  )

  const applyEditionRequest = useCallback(
    (request: NewsEditionRequest) => {
      dayContextRef.current = request.dayContext
      setEditionDate(request.editionDate)
      clearStackedReader()
      setDatePickerOpen(false)
      setGenerationFailed(false)
      if (request.forceGenerate) {
        skipAutoGenerateRef.current = true
        void handleGenerate({
          targetDate: request.editionDate,
          dayContext: request.dayContext,
        })
      }
    },
    [clearStackedReader, handleGenerate],
  )

  useEffect(() => {
    const pending = takePendingNewsEdition()
    if (pending) {
      applyEditionRequest(pending)
    }
    return subscribeNewsEditionRequest(applyEditionRequest)
  }, [applyEditionRequest])

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id)
      if (narrowLayout) {
        setStackedReaderOpen(true)
        setDatePickerOpen(false)
      }
    },
    [narrowLayout],
  )

  const handlePrevDay = useCallback(() => {
    setEditionDate(shiftEditionDate(editionDate, -1))
    clearStackedReader()
    setDatePickerOpen(false)
  }, [clearStackedReader, editionDate])

  const handleNextDay = useCallback(() => {
    setEditionDate(shiftEditionDate(editionDate, 1))
    clearStackedReader()
    setDatePickerOpen(false)
  }, [clearStackedReader, editionDate])

  const handleJumpToToday = useCallback(() => {
    setEditionDate(getTodayEditionDate())
    clearStackedReader()
    setDatePickerOpen(false)
  }, [clearStackedReader])

  const handleDateSelect = useCallback(
    (value: string) => {
      setEditionDate(value)
      clearStackedReader()
      setDatePickerOpen(false)
    },
    [clearStackedReader],
  )

  useEffect(() => {
    if (generateLockRef.current) {
      return
    }
    setStreamingArticleIds([])
    setBaselineArticleIds([])
    setGenerationFailed(false)
    setReasoningText('')
  }, [editionDate])

  // 日期切换后，若当前日期尚无任何新闻，则自动触发生成
  useEffect(() => {
    if (skipAutoGenerateRef.current) {
      skipAutoGenerateRef.current = false
      return
    }
    if (articlesForDay.length === 0 && !isGenerating && !generationFailed) {
      void handleGenerate()
    }
  }, [articlesForDay.length, generationFailed, isGenerating, editionDate, handleGenerate])

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
      {
        label: '朗读',
        items: [
          {
            type: 'action',
            label: readAloud.isActive
              ? '停止朗读'
              : readAloud.panelOpen
                ? '继续朗读'
                : '朗读本文',
            disabled: !canStartSpeech && !readAloud.panelOpen,
            onClick: () => {
              if (readAloud.isActive) {
                readAloud.stop()
                return
              }
              if (readAloud.panelOpen) {
                readAloud.resume()
                return
              }
              if (!canStartSpeech) {
                return
              }
              readAloud.start(speechBlocks)
            },
          },
          {
            type: 'action',
            label: '关闭朗读',
            disabled: !readAloud.panelOpen,
            onClick: () => readAloud.close(),
          },
        ],
      },
    ]
  }, [
    canStartSpeech,
    closeWindowsForApp,
    handleJumpToToday,
    handleNextDay,
    handlePrevDay,
    minimizeWindow,
    readAloud.close,
    readAloud.isActive,
    readAloud.panelOpen,
    readAloud.resume,
    readAloud.start,
    readAloud.stop,
    showBuiltinAbout,
    speechBlocks,
    windows,
  ])

  useAppMenuBar('news', menuBar)

  const dateLabel = formatEditionDateLabel(editionDate)
  const articleDateLabel = formatEditionDateDetailLabel(editionDate)
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
    <div
      ref={hostRef}
      class={`news${narrowLayout ? ' news--narrow' : ''}${narrowLayout && stackedReaderOpen ? ' news--reader-open' : ''}`}
    >
      <header class="news__toolbar">
        {narrowLayout && stackedReaderOpen && (
          <IosNavBackButton
            class="news__toolbar-back"
            iconSize={14}
            label="报道"
            aria-label="返回报道列表"
            onClick={clearStackedReader}
          />
        )}

        <div class="news__date-control">
          <button
            type="button"
            class="news__date-nav"
            onClick={handlePrevDay}
            aria-label="前一天"
            title={`前一天 ${shortPrev}`}
          >
            <BackIcon size={12} />
          </button>
          <button
            type="button"
            class="news__date-label"
            onClick={() => setDatePickerOpen(true)}
            aria-expanded={datePickerOpen}
          >
            {dateLabel}
          </button>
          <button
            type="button"
            class="news__date-nav"
            onClick={handleNextDay}
            aria-label="后一天"
            title={`后一天 ${shortNext}`}
          >
            <ForwardIcon size={12} />
          </button>
        </div>

        {narrowLayout && stackedReaderOpen && <span class="news__toolbar-title">报道</span>}
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
                <ReloadIcon size={12} />
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
                <p>{generationFailed ? '新闻生成失败，请稍后重试' : '这一天还没有新闻'}</p>
              </div>
            )
          ) : (
            isGenerating ? (
              <>
                {streamingArticles.map((article, idx) => renderNewsRow(article, idx))}
                {streamingArticleIds.length === 0 ? (
                  <NewsListThinkingSkeleton reasoningText={reasoningText} />
                ) : (
                  <div class="news__list-skeleton" aria-hidden="true" />
                )}
                {baselineArticles.map((article, idx) => renderNewsRow(article, idx))}
              </>
            ) : (
              listArticles.map((article, idx) => renderNewsRow(article, idx))
            )
          )}
        </aside>

        <section class="news__reader">
          {selectedArticle ? (
            <>
              {readAloud.panelOpen && (
                <div class="news__article-speech">
                  <SpeechReadAloudBar variant="news" controls={readAloud} />
                </div>
              )}
              <article class="news__article">
              <header class="news__article-head">
                <div class="news__article-meta">
                  <span class="news__article-cat">{selectedArticle.category}</span>
                  <span class="news__article-date">{articleDateLabel}</span>
                  {selectedArticle.source && (
                    <span class="news__article-src">{selectedArticle.source}</span>
                  )}
                </div>
                <h1 class="news__article-title">{selectedArticle.title}</h1>
                <p class="news__article-lead">{selectedArticle.lead}</p>
              </header>

              <div class="news__article-body">
                {articleBodyParagraphs(selectedArticle.body).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>

              {!readAloud.panelOpen && (
                <div class="news__article-actions">
                  <button
                    type="button"
                    class="news__btn"
                    disabled={!canStartSpeech}
                    onClick={() => {
                      if (!canStartSpeech) {
                        return
                      }
                      readAloud.start(speechBlocks)
                    }}
                  >
                    朗读
                  </button>
                </div>
              )}

              <NewsCommentsSection
                article={selectedArticle}
                store={store}
                onStoreChange={setStore}
              />
            </article>
            </>
          ) : (
            <div
              class={[
                'news__reader-stack',
                showReaderThinkingOverlay ? 'news__reader-stack--thinking' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {showReaderThinkingOverlay && (
                <div class="news__thinking-backdrop" aria-hidden="true">
                  <AiStreamPreview
                    reasoningText={reasoningText}
                    variant="news"
                    emptyLabel="正在构想当日版面…"
                  />
                </div>
              )}
              <NewsReaderPlaceholder editionDate={editionDate} />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}