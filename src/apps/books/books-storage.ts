import { osNowMs } from '../../os/os-clock.ts'
import { createRegistryStore } from '../../os/registry-store.ts'
import { getBooksContentBytes } from '../../os/device-data-storage.ts'
import { deleteBookChapters } from './books-data-storage.ts'
import { isBookGenerationActive } from './books-generation.ts'
import type {
  BookListing,
  BookRecordMeta,
  BooksIndexStore,
  ChapterIndex,
  ReadingProgress,
} from './books-types.ts'

function emptyStore(): BooksIndexStore {
  return { library: [], catalog: [], readingProgress: {} }
}

function normalizeLibrary(value: unknown): BookRecordMeta[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isBookMetaLike)
}

function isBookMetaLike(value: unknown): value is BookRecordMeta {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }
  const book = value as Record<string, unknown>
  return (
    typeof book.id === 'string' &&
    typeof book.slug === 'string' &&
    typeof book.title === 'string' &&
    typeof book.author === 'string' &&
    (book.status === 'generating' || book.status === 'complete' || book.status === 'failed') &&
    typeof book.addedAt === 'number'
  )
}

function normalizeCatalog(value: unknown): BookListing[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isListingLike)
}

function isListingLike(value: unknown): value is BookListing {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }
  const listing = value as Record<string, unknown>
  return (
    typeof listing.slug === 'string' &&
    typeof listing.title === 'string' &&
    typeof listing.author === 'string' &&
    typeof listing.synopsis === 'string'
  )
}

function normalizeReadingProgress(value: unknown): Record<string, ReadingProgress> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const progress: Record<string, ReadingProgress> = {}
  for (const [bookId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === undefined) {
      continue
    }
    const record = entry as Record<string, unknown>
    if (typeof record.chapterId !== 'string') {
      continue
    }
    progress[bookId] = {
      chapterId: record.chapterId,
      scrollTop: typeof record.scrollTop === 'number' ? record.scrollTop : undefined,
    }
  }
  return progress
}

const registryStore = createRegistryStore<BooksIndexStore>({
  appId: 'books',
  defaultValue: emptyStore,
  legacyKey: 'store',
  fields: [
    {
      key: 'library',
      valueType: 'json',
      read: (store) => store.library,
      write: (value, draft) => ({ ...draft, library: value }),
      normalize: normalizeLibrary,
    },
    {
      key: 'catalog',
      valueType: 'json',
      read: (store) => store.catalog,
      write: (value, draft) => ({ ...draft, catalog: value }),
      normalize: normalizeCatalog,
    },
    {
      key: 'catalogGeneratedAt',
      read: (store) => store.catalogGeneratedAt,
      write: (value, draft) => ({ ...draft, catalogGeneratedAt: value }),
      serialize: (value) => (value === undefined ? '' : String(value)),
      deserialize: (raw) => (raw ? Number(raw) : undefined),
    },
    {
      key: 'readingProgress',
      valueType: 'json',
      read: (store) => store.readingProgress,
      write: (value, draft) => ({ ...draft, readingProgress: value }),
      normalize: normalizeReadingProgress,
    },
  ],
  finalize: reconcileInterruptedBookGenerations,
  changedEventName: 'instant-os:books-store-changed',
})

export function reconcileInterruptedBookGenerations(store: BooksIndexStore): BooksIndexStore {
  let changed = false
  const library = store.library.map((book) => {
    if (book.status !== 'generating' || isBookGenerationActive(book.id)) {
      return book
    }
    changed = true
    return { ...book, status: 'failed' as const }
  })
  return changed ? { ...store, library } : store
}

export function subscribeBooksStore(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

export async function readBooksStore(): Promise<BooksIndexStore> {
  return registryStore.read()
}

export async function writeBooksStore(store: BooksIndexStore): Promise<void> {
  await registryStore.write(store)
}

export async function getBooksDataBytes(): Promise<number> {
  return getBooksContentBytes()
}

export function createBookId(): string {
  return `book-${osNowMs()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createChapterId(): string {
  return `ch-${osNowMs()}-${Math.random().toString(36).slice(2, 10)}`
}

export function findLibraryBook(store: BooksIndexStore, slug: string): BookRecordMeta | undefined {
  return store.library.find((book) => book.slug === slug)
}

export function findLibraryBookById(
  store: BooksIndexStore,
  bookId: string,
): BookRecordMeta | undefined {
  return store.library.find((book) => book.id === bookId)
}

export function upsertCatalog(store: BooksIndexStore, listings: BookListing[]): BooksIndexStore {
  const seen = new Set(store.catalog.map((item) => item.slug))
  const merged = [...store.catalog]
  for (const listing of listings) {
    if (seen.has(listing.slug)) {
      continue
    }
    seen.add(listing.slug)
    merged.push(listing)
  }
  return {
    ...store,
    catalog: merged,
    catalogGeneratedAt: osNowMs(),
  }
}

export function replaceCatalog(store: BooksIndexStore, listings: BookListing[]): BooksIndexStore {
  return {
    ...store,
    catalog: listings,
    catalogGeneratedAt: osNowMs(),
  }
}

export function addBookToLibrary(
  store: BooksIndexStore,
  listing: BookListing,
  detail?: { chapterOutline?: string[] },
): { store: BooksIndexStore; book: BookRecordMeta } {
  const existing = findLibraryBook(store, listing.slug)
  if (existing) {
    return { store, book: existing }
  }

  const book: BookRecordMeta = {
    ...listing,
    id: createBookId(),
    addedAt: osNowMs(),
    status: 'generating',
    chapterCount: detail?.chapterOutline?.length ?? 0,
    chapters: [],
  }

  return {
    store: {
      ...store,
      library: [book, ...store.library],
    },
    book,
  }
}

export function updateBookInLibrary(
  store: BooksIndexStore,
  bookId: string,
  patch: Partial<BookRecordMeta>,
): BooksIndexStore {
  return {
    ...store,
    library: store.library.map((book) => (book.id === bookId ? { ...book, ...patch } : book)),
  }
}

export function appendChapterIndex(
  store: BooksIndexStore,
  bookId: string,
  chapter: ChapterIndex,
): BooksIndexStore {
  const book = findLibraryBookById(store, bookId)
  if (!book) {
    return store
  }
  return updateBookInLibrary(store, bookId, {
    chapters: [...book.chapters, chapter].sort((a, b) => a.index - b.index),
  })
}

export function canOpenBook(book: BookRecordMeta): boolean {
  return book.status === 'complete'
}

export function resetFailedBookForGeneration(
  store: BooksIndexStore,
  bookId: string,
): BooksIndexStore {
  const book = findLibraryBookById(store, bookId)
  if (!book || book.status !== 'failed') {
    return store
  }
  return updateBookInLibrary(store, bookId, {
    status: 'generating',
    chapters: [],
  })
}

export function getBookGenerationPercent(book: BookRecordMeta): number | undefined {
  if (book.status !== 'generating') {
    return undefined
  }
  if (book.chapterCount <= 0) {
    return 0
  }
  return Math.min(100, Math.round((book.chapters.length / book.chapterCount) * 100))
}

export function setReadingProgress(
  store: BooksIndexStore,
  bookId: string,
  progress: ReadingProgress,
): BooksIndexStore {
  return {
    ...store,
    readingProgress: {
      ...store.readingProgress,
      [bookId]: progress,
    },
  }
}

export async function removeBookFromLibrary(
  store: BooksIndexStore,
  bookId: string,
): Promise<BooksIndexStore> {
  await deleteBookChapters(bookId)
  const { [bookId]: _removed, ...readingProgress } = store.readingProgress
  return {
    ...store,
    library: store.library.filter((item) => item.id !== bookId),
    readingProgress,
  }
}

export function buildSeedListings(): BookListing[] {
  return [
    {
      slug: 'doubao-gaokao-guide',
      title: '如何让豆包推迟高考全指南：从提示词到教育局信访的 108 式',
      author: '离谱教程编辑部',
      category: '离谱指南',
      synopsis: '一本声称能教你用 AI 对话技巧影响国家级考试的伪教程，内容荒诞却写得有板有眼。',
      coverColor: '#ff9500',
      coverEmoji: '📕',
    },
    {
      slug: 'rebirth-pr-review',
      title: '重生之我在大厂给 PR 改需求',
      author: '摸鱼仙人',
      category: '职场',
      synopsis: '穿越回入职第一天，发现老板的需求文档里藏着通往另一个维度的注释。',
      coverColor: '#5856d6',
      coverEmoji: '💼',
    },
    {
      slug: 'boss-hp-bar',
      title: '系统面板显示老板血条只有 1% 了',
      author: '打工人联盟',
      category: '系统',
      synopsis: '觉醒职场系统后，每次加班都会扣除老板血量，但补刀需要完成 KPI。',
      coverColor: '#ff3b30',
      coverEmoji: '⚔️',
    },
    {
      slug: 'doomsday-space-hoard',
      title: '末日倒计时 72 小时：我把超市搬进了空间',
      author: '囤货狂魔',
      category: '末日',
      synopsis: '重生回到灾难前三天，戒指空间时间静止——亲戚还在笑我破产，我在仓库刷爆信用卡。',
      coverColor: '#8e8e93',
      coverEmoji: '📦',
    },
    {
      slug: 'canteen-aunt-three-realms',
      title: '穿越成食堂大妈后我靠黑暗料理统一三界',
      author: '锅铲成圣',
      category: '穿越',
      synopsis: '一勺辣椒面下去，魔尊哭着喊再加饭；修仙界从此不设辟谷期。',
      coverColor: '#34c759',
      coverEmoji: '🍲',
    },
    {
      slug: 'alien-internet-cafe',
      title: '猎奇：我在县城网吧见到了上网的外星青少年',
      author: 'UFO 观察员老王',
      category: '猎奇',
      synopsis: '他说来地球是为了补完《原神》主线，临走还顺走了我的泡面。',
      coverColor: '#5ac8fa',
      coverEmoji: '👽',
    },
    {
      slug: 'mars-delivery',
      title: '科幻：火星外卖员的一天',
      author: '星际骑手 007',
      category: '科幻',
      synopsis: '在稀薄大气里送一份麻辣烫，超时扣的是氧气额度。',
      coverColor: '#007aff',
      coverEmoji: '🚀',
    },
  ]
}

export function buildSeedChapters(book: BookRecordMeta): Array<{ index: number; title: string; body: string }> {
  const chapterTitles = [
    '第一章 一切从一个离谱的想法开始',
    '第二章 事情开始失控了',
    '第三章 网友炸了',
  ]
  return chapterTitles.map((title, index) => ({
    index: index + 1,
    title,
    body: `这是《${book.title}》的${title}。\n\n${book.synopsis}\n\n（本地种子章节，配置 AI 后将生成完整逆天正文。）`,
  }))
}
