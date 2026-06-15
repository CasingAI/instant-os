import {
  assertBookChapterCapacity,
  deleteBookChapterRecords,
  deleteBookChapters,
  deleteBookDetailRecord,
  getBookChapter,
  getBookChaptersBytes,
  getBookDetailRecord,
  putBookChapter,
  putBookDetailRecord,
} from '../../os/device-data-storage.ts'
import type { BookDetail, BookListing, ChapterIndex } from './books-types.ts'

export {
  deleteBookChapterRecords,
  deleteBookChapters,
  deleteBookDetailRecord,
  getBookChapter,
  getBookChaptersBytes,
  putBookChapter,
}

export async function saveBookChapter(input: {
  bookId: string
  chapterId: string
  index: number
  title: string
  body: string
}): Promise<boolean> {
  return putBookChapter(input)
}

export async function saveBookChapterOrThrow(input: {
  bookId: string
  chapterId: string
  index: number
  title: string
  body: string
}): Promise<void> {
  await assertBookChapterCapacity(input)
}

export async function loadChapterBody(
  bookId: string,
  chapterId: string,
): Promise<string | undefined> {
  const record = await getBookChapter(bookId, chapterId)
  return record?.body
}

export function countNovelCharacters(text: string): number {
  return text.replace(/\s/g, '').length
}

export function formatNovelCharacterCount(count: number): string {
  if (count >= 10000) {
    const wan = count / 10000
    const rounded =
      wan >= 100 ? Math.round(wan).toString() : wan.toFixed(1).replace(/\.0$/, '')
    return `${rounded} 万字`
  }
  return `${count.toLocaleString('zh-CN')} 字`
}

export async function loadBookCharacterCount(
  bookId: string,
  chapters: ChapterIndex[],
): Promise<number> {
  if (chapters.length === 0) {
    return 0
  }
  const bodies = await Promise.all(chapters.map((chapter) => loadChapterBody(bookId, chapter.id)))
  return bodies.reduce((total, body) => total + countNovelCharacters(body ?? ''), 0)
}

export function detailRecordToBookDetail(record: {
  tagline: string
  longSynopsis: string
  chapterOutline: string[]
}): BookDetail {
  return {
    tagline: record.tagline,
    longSynopsis: record.longSynopsis,
    chapterOutline: record.chapterOutline,
  }
}

export function isBookDetailComplete(detail: Partial<BookDetail> | undefined): detail is BookDetail {
  return Boolean(
    detail?.longSynopsis?.trim() &&
      detail.chapterOutline &&
      detail.chapterOutline.length > 0,
  )
}

export function resolveBookDetail(listing: BookListing, partial: Partial<BookDetail>): BookDetail {
  return {
    tagline: listing.synopsis,
    longSynopsis: partial.longSynopsis?.trim() || '',
    chapterOutline: partial.chapterOutline ?? [],
  }
}

export async function loadBookDetail(slug: string): Promise<BookDetail | undefined> {
  const record = await getBookDetailRecord(slug)
  if (!record) {
    return undefined
  }
  return detailRecordToBookDetail(record)
}

export async function saveBookDetail(slug: string, partial: Partial<BookDetail>): Promise<void> {
  await putBookDetailRecord({
    slug,
    tagline: partial.tagline,
    longSynopsis: partial.longSynopsis,
    chapterOutline: partial.chapterOutline,
  })
}
