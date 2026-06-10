export const BOOK_CATEGORIES = [
  '系统',
  '末日',
  '都市',
  '玄幻',
  '穿越',
  '脑洞',
  '沙雕',
  '科幻',
  '猎奇',
  '恋爱',
  '职场',
  '离谱指南',
] as const

export type BookCategory = (typeof BOOK_CATEGORIES)[number]

export type BookListing = {
  slug: string
  title: string
  author: string
  category: BookCategory | string
  synopsis: string
  coverColor: string
  coverEmoji: string
}

export type ChapterIndex = {
  id: string
  index: number
  title: string
}

export type BookGenerationStatus = 'generating' | 'complete' | 'failed'

export type BookRecordMeta = BookListing & {
  id: string
  addedAt: number
  status: BookGenerationStatus
  chapterCount: number
  chapters: ChapterIndex[]
}

export type ReadingProgress = {
  chapterId: string
  scrollTop?: number
}

export type BooksIndexStore = {
  library: BookRecordMeta[]
  catalog: BookListing[]
  catalogGeneratedAt?: number
  readingProgress: Record<string, ReadingProgress>
}

export type BookDetail = {
  tagline: string
  longSynopsis: string
  chapterOutline: string[]
}

export type GeneratedListingDraft = {
  slug?: string
  title?: string
  author?: string
  category?: string
  synopsis?: string
  coverColor?: string
  coverEmoji?: string
}

export type GeneratedChapterDraft = {
  index?: number
  title?: string
  body?: string
}

export type GeneratedDetailDraft = {
  tagline?: string
  longSynopsis?: string
  chapterOutline?: string[]
}
