import { useEffect, useState } from 'preact/hooks'
import { generateBookDetailStreaming } from './books-agent.ts'
import {
  formatNovelCharacterCount,
  isBookDetailComplete,
  loadBookCharacterCount,
  loadBookDetail,
  resolveBookDetail,
  saveBookDetail,
} from './books-data-storage.ts'
import { BooksCover, listingToCoverProps } from './books-cover.tsx'
import {
  BOOK_GENERATION_PROGRESS_EVENT,
  type BookGenerationPhase,
  type BookGenerationProgressDetail,
  getBookGenerationActivity,
  getBookGenerationLiveCharacterCount,
  isBookGenerationActive,
} from './books-generation.ts'
import {
  canOpenBook,
  findLibraryBookById,
  getBookGenerationPercent,
  readBooksStore,
} from './books-storage.ts'
import type { BookDetail, BookListing, BookRecordMeta } from './books-types.ts'

type BooksStoreDetailProps = {
  listing: BookListing
  libraryBook?: BookRecordMeta
  isAdding: boolean
  onAddToShelf: (detail: BookDetail) => void
  onRead: () => void
}

export function BooksStoreDetail({
  listing,
  libraryBook,
  isAdding,
  onAddToShelf,
  onRead,
}: BooksStoreDetailProps) {
  const [detail, setDetail] = useState<Partial<BookDetail> | undefined>()
  const [streaming, setStreaming] = useState(true)
  const [persistedCharacterCount, setPersistedCharacterCount] = useState<number | undefined>()
  const [liveCharacterCount, setLiveCharacterCount] = useState(0)
  const [generationPhase, setGenerationPhase] = useState<BookGenerationPhase>('connecting')
  const [generationStalled, setGenerationStalled] = useState(false)

  const generationActive = Boolean(libraryBook && isBookGenerationActive(libraryBook.id))

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setDetail(undefined)
      setStreaming(true)

      const cached = await loadBookDetail(listing.slug)
      if (cancelled) {
        return
      }

      if (cached && isBookDetailComplete(cached)) {
        const resolved = resolveBookDetail(listing, cached)
        setDetail(resolved)
        if (resolved.tagline !== cached.tagline) {
          void saveBookDetail(listing.slug, resolved)
        }
        setStreaming(false)
        return
      }

      if (cached) {
        setDetail(resolveBookDetail(listing, cached))
      }

      await generateBookDetailStreaming(listing, (partial) => {
        if (cancelled) {
          return
        }
        setDetail((current) => {
          const merged = resolveBookDetail(listing, { ...current, ...partial })
          void saveBookDetail(listing.slug, merged)
          return merged
        })
      })
        .then((finalDetail) => {
          if (!cancelled) {
            const resolved = resolveBookDetail(listing, finalDetail)
            setDetail(resolved)
            void saveBookDetail(listing.slug, resolved)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setStreaming(false)
          }
        })
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [listing.slug, listing.synopsis])

  const completeDetail = isBookDetailComplete(detail) ? resolveBookDetail(listing, detail) : undefined
  const showSynopsisSection = Boolean(detail?.longSynopsis || streaming)
  const showOutlineSection = Boolean(detail?.chapterOutline?.length || streaming)
  const generationPercent = libraryBook ? getBookGenerationPercent(libraryBook) : undefined
  const openable = libraryBook ? canOpenBook(libraryBook) : false
  const generatingChapters = Boolean(libraryBook && !openable && libraryBook.status !== 'failed')
  const showCharacterCount = Boolean(
    libraryBook && (libraryBook.status === 'generating' || libraryBook.status === 'complete'),
  )
  const chapterSignature = libraryBook?.chapters.map((chapter) => chapter.id).join(',')

  useEffect(() => {
    if (!showCharacterCount || !libraryBook) {
      setPersistedCharacterCount(undefined)
      setLiveCharacterCount(0)
      return
    }

    let cancelled = false

    const refreshPersisted = async () => {
      const store = await readBooksStore()
      const book = findLibraryBookById(store, libraryBook.id)
      if (!book) {
        if (!cancelled) {
          setPersistedCharacterCount(undefined)
        }
        return
      }
      const count = await loadBookCharacterCount(book.id, book.chapters)
      if (!cancelled) {
        setPersistedCharacterCount(count)
      }
    }

    const refreshLive = () => {
      if (!cancelled && isBookGenerationActive(libraryBook.id)) {
        const activity = getBookGenerationActivity(libraryBook.id)
        setLiveCharacterCount(getBookGenerationLiveCharacterCount(libraryBook.id))
        setGenerationPhase(activity.phase)
        setGenerationStalled(Date.now() - activity.lastActivityAt > 45_000)
      } else if (!cancelled) {
        setGenerationStalled(false)
      }
    }

    void refreshPersisted()
    refreshLive()

    const onStoreChanged = () => {
      void refreshPersisted()
      refreshLive()
    }
    const onGenerationProgress = (event: Event) => {
      const detail = (event as CustomEvent<BookGenerationProgressDetail>).detail
      if (!cancelled && detail.bookId === libraryBook.id) {
        setLiveCharacterCount(detail.count)
        setGenerationPhase(detail.phase)
        setGenerationStalled(Date.now() - detail.lastActivityAt > 45_000)
      }
    }

    window.addEventListener('instant-os:books-store-changed', onStoreChanged)
    window.addEventListener(BOOK_GENERATION_PROGRESS_EVENT, onGenerationProgress)
    const stallTimer = window.setInterval(refreshLive, 3000)

    return () => {
      cancelled = true
      window.clearInterval(stallTimer)
      window.removeEventListener('instant-os:books-store-changed', onStoreChanged)
      window.removeEventListener(BOOK_GENERATION_PROGRESS_EVENT, onGenerationProgress)
    }
  }, [chapterSignature, libraryBook?.id, showCharacterCount])

  const generationStatusLabel = () => {
    if (generationStalled) {
      return '长时间无新数据…'
    }
    if (generationPhase === 'connecting') {
      return '连接中…'
    }
    if (generationPhase === 'thinking') {
      return '思考中…'
    }
    return `正在下载${generationPercent !== undefined ? ` ${generationPercent}%` : ''}`
  }

  const characterCount = generationActive ? liveCharacterCount : persistedCharacterCount

  return (
    <div class="books-detail">
      <div class="books-detail__hero">
        <BooksCover
          {...listingToCoverProps(listing)}
          size="large"
          dimmed={generatingChapters}
          progress={generationPercent}
        />
        <div class="books-detail__info">
          <h1 class="books-detail__title">{listing.title}</h1>
          <p class="books-detail__author">{listing.author}</p>
          <p class="books-detail__tagline">{listing.synopsis}</p>
          <div class="books-detail__actions">
            {openable ? (
              <button type="button" class="books-detail__btn" onClick={onRead}>
                开始阅读
              </button>
            ) : generatingChapters || isAdding ? (
              <button type="button" class="books-detail__btn" disabled>
                {generationStatusLabel()}
              </button>
            ) : (
              <button
                type="button"
                class="books-detail__btn"
                disabled={streaming || !completeDetail}
                onClick={() => completeDetail && onAddToShelf(completeDetail)}
              >
                {streaming
                  ? '正在加载'
                  : libraryBook?.status === 'failed'
                    ? '重新下载'
                    : '加入书架'}
              </button>
            )}
          </div>
        </div>
      </div>

      {(showSynopsisSection || showOutlineSection) && (
        <div class="books-detail__body">
          {showSynopsisSection && (
            <section class="books-detail__synopsis-section">
              <h2 class="books-detail__section-title">简介</h2>
              <div
                class={`books-detail__synopsis${streaming && !detail?.longSynopsis ? ' books-detail__streaming' : ''}`}
              >
                {detail?.longSynopsis
                  ? detail.longSynopsis.split(/\n+/).map((paragraph) => (
                      <p key={paragraph.slice(0, 32)}>{paragraph}</p>
                    ))
                  : streaming && <p>正在加载</p>}
              </div>
            </section>
          )}

          {showOutlineSection && (
            <section class="books-detail__outline">
              <h2 class="books-detail__outline-title">章节目录</h2>
              {detail?.chapterOutline && detail.chapterOutline.length > 0 ? (
                <ol class="books-detail__outline-list">
                  {detail.chapterOutline.map((chapter, index) => (
                    <li
                      key={`${chapter}-${index}`}
                      class={
                        streaming && index === detail.chapterOutline!.length - 1
                          ? 'books-detail__outline-item--new'
                          : ''
                      }
                    >
                      {chapter}
                    </li>
                  ))}
                </ol>
              ) : (
                streaming && (
                  <div class="books-detail__outline-skeleton">
                    <div class="books-detail__outline-skeleton-line" />
                    <div class="books-detail__outline-skeleton-line" />
                    <div class="books-detail__outline-skeleton-line books-detail__outline-skeleton-line--short" />
                  </div>
                )
              )}
            </section>
          )}
        </div>
      )}

      {showCharacterCount && (
        <p class="books-detail__debug-foot">
          字数 {characterCount !== undefined ? formatNovelCharacterCount(characterCount) : '…'}
          {generationActive && generationStalled ? ' · 超过 45 秒无新数据' : ''}
        </p>
      )}
    </div>
  )
}
