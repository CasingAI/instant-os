import { useEffect, useMemo, useState } from 'preact/hooks'
import type { SpeechBlock } from '../../ai/speech-read-aloud.ts'
import { useSpeechReadAloud } from '../../ai/use-speech-read-aloud.ts'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SpeechReadAloudBar } from '../../ui/speech-read-aloud-bar.tsx'
import { loadChapterBody } from './books-data-storage.ts'
import { readBooksStore, setReadingProgress, writeBooksStore } from './books-storage.ts'
import type { BookRecordMeta, BooksIndexStore, ChapterIndex } from './books-types.ts'

type BooksReaderProps = {
  book: BookRecordMeta
  store: BooksIndexStore
  onStoreChange: (store: BooksIndexStore) => void
  onBack: () => void
}

const BOOKS_SPEECH_USAGE = {
  actor: 'books',
  behavior: 'read-aloud',
  behaviorLabel: '朗读',
} as const

function bodyToParagraphs(body: string): string[] {
  return body
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function chapterToSpeechBlocks(
  title: string | undefined,
  body: string,
): SpeechBlock[] {
  const blocks: SpeechBlock[] = []
  const trimmedTitle = title?.trim()
  if (trimmedTitle) {
    blocks.push({ id: 'title', text: trimmedTitle })
  }
  bodyToParagraphs(body).forEach((paragraph, index) => {
    blocks.push({ id: `body-${index}`, text: paragraph })
  })
  return blocks
}

export function BooksReader({ book, store, onStoreChange, onBack }: BooksReaderProps) {
  const chapters = book.chapters
  const savedProgress = store.readingProgress[book.id]
  const readAloud = useSpeechReadAloud(BOOKS_SPEECH_USAGE)
  const { close: closeReadAloud } = readAloud

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
  const bodyParagraphs = useMemo(
    () => (body ? bodyToParagraphs(body) : []),
    [body],
  )
  const speechBlocks = useMemo(
    () =>
      body ? chapterToSpeechBlocks(currentChapter?.title, body) : [],
    [body, currentChapter?.title],
  )
  const canReadAloud = speechBlocks.length > 0 && !loading && !error

  useEffect(() => {
    if (!currentChapter) {
      setBody(undefined)
      setLoading(false)
      setError(chapters.length === 0 ? '章节尚未下载，请稍后再试' : undefined)
      return
    }

    const chapterId = currentChapter.id

    let cancelled = false
    setLoading(true)
    setError(undefined)
    closeReadAloud()

    void loadChapterBody(book.id, chapterId).then((text) => {
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

    const persistProgress = async () => {
      const current = await readBooksStore()
      const nextStore = setReadingProgress(current, book.id, { chapterId })
      await writeBooksStore(nextStore)
      onStoreChange(nextStore)
    }
    void persistProgress()

    return () => {
      cancelled = true
    }
  }, [book.id, currentChapter?.id, closeReadAloud, onStoreChange])

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

  const speechOpen = readAloud.panelOpen

  return (
    <>
      <header class="books__toolbar">
        <IosNavBackButton iconSize={14} label="书架" onClick={onBack} />
        <span class="books__toolbar-title books__toolbar-title--center">{book.title}</span>
        {speechOpen ? (
          <span class="books__toolbar-spacer" />
        ) : (
          <IosButton
            size="compact"
            disabled={!canReadAloud}
            onClick={() => {
              if (!canReadAloud) {
                return
              }
              readAloud.start(speechBlocks)
            }}
          >
            朗读
          </IosButton>
        )}
      </header>
      <div class="books__main">
        <div class="books-reader">
          {speechOpen && (
            <div class="books-reader__speech">
              <SpeechReadAloudBar variant="books" controls={readAloud} />
            </div>
          )}
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
                  {bodyParagraphs.map((paragraph, index) => (
                    <p key={`${index}:${paragraph.slice(0, 24)}`}>{paragraph}</p>
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
      </div>
    </>
  )
}
