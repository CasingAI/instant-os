import { useEffect, useMemo, useState } from 'preact/hooks'
import { loadChapterBody } from './books-data-storage.ts'
import { readBooksStore, setReadingProgress, writeBooksStore } from './books-storage.ts'
import type { BookRecordMeta, BooksIndexStore, ChapterIndex } from './books-types.ts'

type BooksReaderProps = {
  book: BookRecordMeta
  store: BooksIndexStore
  onStoreChange: (store: BooksIndexStore) => void
}

function bodyToParagraphs(body: string): string[] {
  return body
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export function BooksReader({ book, store, onStoreChange }: BooksReaderProps) {
  const chapters = book.chapters
  const savedProgress = store.readingProgress[book.id]

  const initialChapterIndex = useMemo(() => {
    if (savedProgress) {
      const idx = chapters.findIndex((ch) => ch.id === savedProgress.chapterId)
      if (idx >= 0) {
        return idx
      }
    }
    return 0
  }, [chapters, savedProgress])

  const [chapterIndex, setChapterIndex] = useState(initialChapterIndex)
  const [body, setBody] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const currentChapter: ChapterIndex | undefined = chapters[chapterIndex]

  useEffect(() => {
    if (!currentChapter) {
      setBody(undefined)
      setLoading(false)
      setError(chapters.length === 0 ? '章节尚未下载，请稍后再试' : undefined)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(undefined)

    void loadChapterBody(book.id, currentChapter.id).then((text) => {
      if (cancelled) {
        return
      }
      if (!text) {
        setError('无法加载章节内容')
        setBody(undefined)
      } else {
        setBody(text)
      }
      setLoading(false)
    })

    const nextStore = setReadingProgress(readBooksStore(), book.id, { chapterId: currentChapter.id })
    writeBooksStore(nextStore)
    onStoreChange(nextStore)

    return () => {
      cancelled = true
    }
  }, [book.id, currentChapter?.id])

  const goPrev = () => {
    if (chapterIndex > 0) {
      setChapterIndex(chapterIndex - 1)
    }
  }

  const goNext = () => {
    if (chapterIndex < chapters.length - 1) {
      setChapterIndex(chapterIndex + 1)
    }
  }

  return (
    <div class="books-reader">
      <div class="books-reader__content">
        {loading ? (
          <div class="books-reader__loading">
            <div class="books-store__spinner" />
            <p>加载章节…</p>
            <div style={{ width: '100%', maxWidth: '480px' }}>
              <div class="books-reader__skeleton" style={{ width: '60%' }} />
              <div class="books-reader__skeleton" />
              <div class="books-reader__skeleton" />
              <div class="books-reader__skeleton" style={{ width: '80%' }} />
            </div>
          </div>
        ) : error ? (
          <div class="books-reader__loading">
            <p>{error}</p>
          </div>
        ) : (
          <>
            <h1 class="books-reader__chapter-title">{currentChapter?.title}</h1>
            <div class="books-reader__body">
              {body &&
                bodyToParagraphs(body).map((paragraph) => (
                  <p key={paragraph.slice(0, 24)}>{paragraph}</p>
                ))}
            </div>
          </>
        )}
      </div>

      <div class="books-reader__footer">
        <button
          type="button"
          class="books-reader__nav-btn"
          disabled={chapterIndex <= 0}
          onClick={goPrev}
        >
          上一章
        </button>
        <span class="books-reader__progress-label">
          {chapters.length > 0
            ? `第 ${chapterIndex + 1} 章 / 共 ${chapters.length} 章`
            : '暂无章节'}
        </span>
        <button
          type="button"
          class="books-reader__nav-btn"
          disabled={chapterIndex >= chapters.length - 1}
          onClick={goNext}
        >
          下一章
        </button>
      </div>
    </div>
  )
}
