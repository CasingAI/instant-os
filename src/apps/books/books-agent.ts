import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import {
  createNdjsonLineFeed,
  extractPartialObjectFields,
  extractPartialStringField,
  parseNdjsonLine,
} from '../../ai/parse-streaming-json.ts'
import { isStreamIdleTimeoutError, streamChatCompletion } from '../../ai/stream-chat.ts'
import { hasOpenAiApiKey } from '../../ai/openai-config.ts'
import {
  appendChapterIndex,
  buildSeedChapters,
  buildSeedListings,
  createChapterId,
  findLibraryBookById,
  readBooksStore,
  updateBookInLibrary,
  writeBooksStore,
} from './books-storage.ts'
import { countNovelCharacters, loadChapterBody, saveBookChapterOrThrow } from './books-data-storage.ts'
import {
  beginBookGeneration,
  endBookGeneration,
  isBookGenerationCancelled,
  publishBookGenerationProgress,
} from './books-generation.ts'
import type {
  BookCategory,
  BookDetail,
  BookListing,
  BookRecordMeta,
  GeneratedChapterDraft,
  GeneratedDetailDraft,
  GeneratedListingDraft,
} from './books-types.ts'
import { BOOK_CATEGORIES } from './books-types.ts'
import { normalizeBookCategory } from './books-genre-templates.ts'
import {
  formatGenreTemplateForPrompt,
  pickGenreTemplateForBook,
} from './books-genre-templates.ts'

const LISTING_LINE_EXAMPLE = JSON.stringify({
  slug: 'doubao-gaokao-guide',
  title: '如何让豆包推迟高考全指南',
  author: '离谱教程编辑部',
  category: '离谱指南',
  synopsis: '一本声称能教你用 AI 影响国家级考试的伪教程。',
  coverColor: '#ff9500',
  coverEmoji: '📕',
})

const CATALOG_PROMPT = `你是 Instant OS 图书城 AI 编辑。
Instant OS 是一个 iOS 6 拟物风格的网页桌面系统，图书 App 仿 iBooks，所有书籍均为 AI 虚构网文。

任务：生成一批原创中文书籍目录条目（不是真实出版的书）。

必须采用 NDJSON 格式：每行一个完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。
每行格式：${LISTING_LINE_EXAMPLE}

字段：slug（英文连字符 id）、title、author、category、synopsis（40~80字）、coverColor（十六进制）、coverEmoji（一个 emoji）

分类只能从以下选取：${BOOK_CATEGORIES.join('、')}

要求：
- 生成 8~10 本书，逐行输出
- 每批至少覆盖 4 个不同分类
- 至少 1 本必须是「系统」类（任务面板/签到/属性加点，可与其他题材组合如末世+系统、都市+系统）
- 至少 1 本必须是「末日」类（天灾/丧尸/秩序崩塌，优先考虑囤货、空间、倒计时求生）
- 至少 2 本必须是逆天/沙雕/标题党网文风格
- 至少 1 本必须是「离谱指南」类伪教程（如：如何让豆包推迟高考全指南）
- 标题可以很长、很野、很好笑；内容设定虚构，不涉及真实名人造谣
- slug 必须唯一、URL 安全
- 每本书的 title 与 synopsis 必须贴合其 category 的经典网文套路（如系统=任务面板/签到、末日=囤货倒计时/空间、都市=赘婿逆袭、离谱指南=伪教程）
- 生成完一本就立刻输出一行`

function buildDetailPrompt(templateBlock: string): string {
  return `你是 Instant OS 图书城 AI 详情页撰写助手。
用户会提供一本书的基本信息（含书城列表里的一句话简介），请撰写详情页扩展内容。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "longSynopsis": "2~4段介绍，300~600字，网文推荐语风格，段落间用\\n\\n分隔。在列表简介基础上扩写，不要重复粘贴原句",
  "chapterOutline": ["第一章 xxx", "第二章 xxx", ... 共 4~6 章]
}

要求：风格搞笑、逆天、吸引人；chapterOutline 每章标题要有网文感，且严格对应下方套路模板的章节推进。不要生成 tagline 或副标题字段。

${templateBlock}`
}

const DETAIL_STREAM_FIELDS = ['longSynopsis'] as const

function extractPartialChapterOutline(text: string): string[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const keyIndex = cleaned.indexOf('"chapterOutline"')
  if (keyIndex === -1) {
    return []
  }

  const bracketStart = cleaned.indexOf('[', keyIndex)
  if (bracketStart === -1) {
    return []
  }

  const items: string[] = []
  let index = bracketStart + 1

  while (index < cleaned.length) {
    while (index < cleaned.length && /[\s,]/.test(cleaned[index])) {
      index += 1
    }

    if (cleaned[index] === ']') {
      break
    }

    if (cleaned[index] !== '"') {
      break
    }

    index += 1
    let value = ''
    let escaped = false
    let closed = false

    for (; index < cleaned.length; index += 1) {
      const char = cleaned[index]

      if (escaped) {
        if (char === 'n') {
          value += '\n'
        } else if (char === 't') {
          value += '\t'
        } else {
          value += char
        }
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        closed = true
        index += 1
        break
      }

      value += char
    }

    if (!closed) {
      break
    }

    const trimmed = value.trim()
    if (trimmed) {
      items.push(trimmed)
    }
  }

  return items
}

function mergeDetailPartial(
  accumulated: string,
  partial: Partial<Pick<BookDetail, 'longSynopsis'>>,
): Partial<BookDetail> {
  const outline = extractPartialChapterOutline(accumulated)
  return {
    ...partial,
    ...(outline.length > 0 ? { chapterOutline: outline } : {}),
  }
}

async function simulateDetailStream(
  listing: BookListing,
  detail: Omit<BookDetail, 'tagline'>,
  onUpdate: (partial: Partial<BookDetail>) => void,
): Promise<void> {
  const tagline = listing.synopsis
  const synopsis = detail.longSynopsis

  onUpdate({ tagline })

  for (let length = 1; length <= synopsis.length; length += 4) {
    onUpdate({ tagline, longSynopsis: synopsis.slice(0, length) })
    await new Promise((resolve) => setTimeout(resolve, 16))
  }

  for (let count = 1; count <= detail.chapterOutline.length; count += 1) {
    onUpdate({
      tagline,
      longSynopsis: synopsis,
      chapterOutline: detail.chapterOutline.slice(0, count),
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
}

const CHAPTER_LINE_EXAMPLE = JSON.stringify({
  index: 1,
  title: '第一章 一切从一个离谱的想法开始',
  body: '正文第一段...\\n\\n第二段...',
})

/** 连续收不到任何流式分片超过此时长才判定卡死（与单章总耗时无关） */
const BOOK_CHAPTER_STREAM_IDLE_MS = 300_000

function buildSingleChapterPrompt(templateBlock: string): string {
  return `你是 Instant OS 图书 App 的 AI 网文写手。
Instant OS 是 iOS 6 拟物风格桌面，所有书籍均为虚构娱乐内容。

任务：根据书籍信息与章节目录，只撰写用户指定的单章正文。

必须采用 NDJSON 格式：只输出一行完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。
格式：${CHAPTER_LINE_EXAMPLE}

字段：index（从1起）、title、body（800~1500字，3~6段，用\\n\\n分段）

要求：
- 只输出本章一行 JSON，不要输出其他章节
- 严格遵循下方套路模板：落实模板中的结构节点与必备元素
- 网文口语化，梗密集，情节离谱但自洽
- 本章至少一个小爽点或笑点，章末留钩子（悬念/反转/震惊反应）
- 对话用中文引号；段落间用\\n\\n
- 不涉及真实名人、不越安全红线；可以荒诞搞笑

${templateBlock}`
}

function normalizeListing(
  raw: GeneratedListingDraft,
  index: number,
  forcedCategory?: BookCategory,
): BookListing {
  const slug =
    raw.slug?.trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase() ||
    `book-${Date.now()}-${index}`
  const category = forcedCategory ?? normalizeBookCategory(raw.category?.trim() || '脑洞')
  return {
    slug,
    title: raw.title?.trim() || '未命名奇书',
    author: raw.author?.trim() || '匿名作者',
    category,
    synopsis: raw.synopsis?.trim() || '一本来历不明的好书。',
    coverColor: raw.coverColor?.trim() || '#ff9500',
    coverEmoji: raw.coverEmoji?.trim() || '📖',
  }
}

function buildCategoryCatalogPrompt(category: BookCategory): string {
  return `${CATALOG_PROMPT}

本批次附加硬性要求：
- 生成的 6~8 本书，category 字段必须全部是「${category}」
- 不得出现其他分类
- 每本必须深度贴合「${category}」类网文经典套路与读者期待`
}

function buildSeedListingsForCategory(category: BookCategory): BookListing[] {
  const matched = buildSeedListings().filter(
    (listing) => normalizeBookCategory(listing.category) === category,
  )
  if (matched.length > 0) {
    return matched
  }

  const placeholders: BookListing[] = []
  for (let index = 0; index < 3; index += 1) {
    placeholders.push({
      slug: `${category}-preview-${Date.now()}-${index}`,
      title: `【${category}】本地预览 ${index + 1}`,
      author: 'Instant OS 书城',
      category,
      synopsis: `「${category}」分类预览书目。配置 AI 后将自动生成该分类的完整逆天目录。`,
      coverColor: '#ff9500',
      coverEmoji: '📖',
    })
  }
  return placeholders
}

async function streamCatalogListings(
  system: string,
  user: string,
  onListing: (listing: BookListing) => void,
  forcedCategory?: BookCategory,
): Promise<BookListing[]> {
  if (!hasOpenAiApiKey()) {
    const seeds = forcedCategory ? buildSeedListingsForCategory(forcedCategory) : buildSeedListings()
    for (const listing of seeds) {
      onListing(listing)
    }
    return seeds
  }

  const listings: BookListing[] = []
  const seenSlugs = new Set<string>()
  const feed = createNdjsonLineFeed((line) => {
    try {
      const raw = parseNdjsonLine<GeneratedListingDraft>(line)
      const listing = normalizeListing(raw, listings.length, forcedCategory)
      if (seenSlugs.has(listing.slug)) {
        return
      }
      seenSlugs.add(listing.slug)
      listings.push(listing)
      onListing(listing)
    } catch {
      // ignore partial lines
    }
  })

  try {
    const text = await streamChatCompletion({
      system,
      user,
      onChunk: (delta) => feed.push(delta),
    })
    feed.flush()

    if (listings.length === 0) {
      const drafts = parseJsonFromAiText<GeneratedListingDraft[]>(text)
      if (Array.isArray(drafts)) {
        for (const [index, raw] of drafts.entries()) {
          const listing = normalizeListing(raw, index, forcedCategory)
          if (!seenSlugs.has(listing.slug)) {
            seenSlugs.add(listing.slug)
            listings.push(listing)
            onListing(listing)
          }
        }
      }
    }

    if (listings.length === 0) {
      throw new Error('empty catalog')
    }
    return listings
  } catch {
    const seeds = forcedCategory ? buildSeedListingsForCategory(forcedCategory) : buildSeedListings()
    for (const listing of seeds) {
      onListing(listing)
    }
    return seeds
  }
}

function normalizeDetail(raw: GeneratedDetailDraft, listing: BookListing): BookDetail {
  const outline = Array.isArray(raw.chapterOutline)
    ? raw.chapterOutline.filter((item) => typeof item === 'string' && item.trim())
    : []
  return {
    tagline: listing.synopsis,
    longSynopsis: raw.longSynopsis?.trim() || '',
    chapterOutline: outline.length > 0 ? outline : ['第一章', '第二章', '第三章'],
  }
}

function withListingTagline(listing: BookListing, partial: Partial<BookDetail>): Partial<BookDetail> {
  return { ...partial, tagline: listing.synopsis }
}

function finalizeDetail(listing: BookListing, partial: Partial<BookDetail>): BookDetail {
  return {
    tagline: listing.synopsis,
    longSynopsis: partial.longSynopsis?.trim() || listing.synopsis,
    chapterOutline:
      partial.chapterOutline && partial.chapterOutline.length > 0
        ? partial.chapterOutline
        : ['第一章', '第二章', '第三章'],
  }
}

function normalizeChapter(raw: GeneratedChapterDraft): { index: number; title: string; body: string } | undefined {
  const index = typeof raw.index === 'number' ? raw.index : undefined
  const title = raw.title?.trim()
  const body = (raw.body || '').trim().replace(/\\n/g, '\n')
  if (index === undefined || !title || !body) {
    return undefined
  }
  return { index, title, body }
}

export async function generateStoreCatalogStreaming(
  onListing: (listing: BookListing) => void,
): Promise<BookListing[]> {
  return streamCatalogListings(
    CATALOG_PROMPT,
    '请生成一批图书城新书目录，风格要多搞笑、多逆天、多猎奇。',
    onListing,
  )
}

export async function generateStoreCatalogForCategoryStreaming(
  category: BookCategory,
  onListing: (listing: BookListing) => void,
): Promise<BookListing[]> {
  return streamCatalogListings(
    buildCategoryCatalogPrompt(category),
    `请专门为「${category}」分类生成一批新书目录，风格要多搞笑、多逆天，严格贴合该类型网文套路。`,
    onListing,
    category,
  )
}

export async function generateBookDetailStreaming(
  listing: BookListing,
  onUpdate: (partial: Partial<BookDetail>) => void,
): Promise<BookDetail> {
  const emit = (partial: Partial<BookDetail>) => onUpdate(withListingTagline(listing, partial))

  emit({ tagline: listing.synopsis })

  const fallbackBody = {
    longSynopsis: listing.synopsis,
    chapterOutline: ['第一章', '第二章', '第三章'],
  }

  if (!hasOpenAiApiKey()) {
    const seedBody = {
      longSynopsis: `${listing.synopsis}\n\n（本地预览 · 配置 AI 后生成完整详情）`,
      chapterOutline: ['第一章 开篇即高潮', '第二章 事情不对劲了', '第三章 全网震惊'],
    }
    await simulateDetailStream(listing, seedBody, emit)
    const seed = finalizeDetail(listing, seedBody)
    emit(seed)
    return seed
  }

  const template = pickGenreTemplateForBook(listing.category, listing.slug)
  const templateBlock = formatGenreTemplateForPrompt(template)
  const userMessage = `书名：${listing.title}\n作者：${listing.author}\n分类：${listing.category}\n列表简介（详情页头部将直接展示此句，请勿改写）：${listing.synopsis}\n\n请按「${template.name}」套路设计 longSynopsis 与 chapterOutline。`

  try {
    const text = await streamChatCompletion({
      system: buildDetailPrompt(templateBlock),
      user: userMessage,
      onChunk: (_delta, accumulated) => {
        const stringPartial = extractPartialObjectFields<Pick<BookDetail, 'longSynopsis'>>(
          accumulated,
          DETAIL_STREAM_FIELDS,
        )
        const merged = mergeDetailPartial(accumulated, stringPartial)
        if (Object.keys(merged).length > 0) {
          emit(merged)
        }
      },
    })

    const raw = parseJsonFromAiText<GeneratedDetailDraft>(text)
    const normalized = normalizeDetail(raw, listing)
    emit(normalized)
    return normalized
  } catch {
    await simulateDetailStream(listing, fallbackBody, emit)
    const fallback = finalizeDetail(listing, fallbackBody)
    emit(fallback)
    return fallback
  }
}

export async function generateBookDetail(listing: BookListing): Promise<BookDetail> {
  return generateBookDetailStreaming(listing, () => {})
}

function estimateLiveChapterCharacterCount(
  chapterBodies: Map<number, string>,
  pendingLine: string,
  draftingIndex?: number,
): number {
  let total = 0
  for (const [index, body] of chapterBodies.entries()) {
    if (draftingIndex !== undefined && index === draftingIndex) {
      continue
    }
    total += countNovelCharacters(body)
  }
  const partialBody = extractPartialStringField(pendingLine, 'body')
  if (partialBody) {
    total += countNovelCharacters(partialBody)
  }
  return total
}

function parseChapterFromText(text: string, expectedIndex: number): ReturnType<typeof normalizeChapter> {
  const trimmed = text.trim()
  if (!trimmed) {
    return undefined
  }

  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    try {
      const chapter = normalizeChapter(parseNdjsonLine<GeneratedChapterDraft>(line))
      if (chapter && chapter.index === expectedIndex) {
        return chapter
      }
    } catch {
      // try next line
    }
  }

  try {
    const draft = parseJsonFromAiText<GeneratedChapterDraft>(trimmed)
    const chapter = normalizeChapter(draft)
    if (chapter && chapter.index === expectedIndex) {
      return chapter
    }
  } catch {
    // ignore
  }

  return undefined
}

async function generateOneChapterStreaming(
  bookId: string,
  listing: BookListing,
  detail: BookDetail,
  chapterIndex: number,
  templateBlock: string,
  chapterBodies: Map<number, string>,
  publishLiveCharacterCount: (pendingLine?: string, draftingIndex?: number) => void,
): Promise<ReturnType<typeof normalizeChapter>> {
  const total = detail.chapterOutline.length
  const chapterTitle = detail.chapterOutline[chapterIndex - 1] ?? `第${chapterIndex}章`
  const outlineText = detail.chapterOutline.map((title, index) => `${index + 1}. ${title}`).join('\n')
  const userMessage = `书名：${listing.title}
作者：${listing.author}
分类：${listing.category}
列表简介：${listing.synopsis}
详细介绍：${detail.longSynopsis}

全书章节目录（共 ${total} 章）：
${outlineText}

当前任务：只撰写第 ${chapterIndex} 章「${chapterTitle}」。
请只输出这一章，index 必须为 ${chapterIndex}，title 与目录一致或轻微润色。`

  let parsed: ReturnType<typeof normalizeChapter> | undefined
  const feed = createNdjsonLineFeed((line) => {
    const chapter = parseChapterFromText(line, chapterIndex)
    if (chapter) {
      parsed = chapter
      chapterBodies.set(chapter.index, chapter.body)
      publishLiveCharacterCount(feed.getBuffer(), chapterIndex)
    }
  })

  publishBookGenerationProgress(bookId, { phase: 'connecting' })

  const text = await streamChatCompletion({
    system: buildSingleChapterPrompt(templateBlock),
    user: userMessage,
    thinkingEnabled: false,
    idleTimeoutMs: BOOK_CHAPTER_STREAM_IDLE_MS,
    onStreamActivity: (kind) => {
      publishBookGenerationProgress(bookId, {
        phase: kind === 'reasoning' ? 'thinking' : 'writing',
      })
    },
    onAnyStreamChunk: () => {
      publishBookGenerationProgress(bookId, {})
    },
    onChunk: (delta) => {
      feed.push(delta)
      publishLiveCharacterCount(feed.getBuffer(), chapterIndex)
    },
  })

  feed.flush()

  if (!parsed) {
    parsed = parseChapterFromText(text, chapterIndex)
  }

  return parsed
}

export async function generateBookChaptersStreaming(
  bookId: string,
  listing: BookListing,
  detail: BookDetail,
  onChapterSaved: (chapterIndex: number, total: number) => void,
): Promise<void> {
  beginBookGeneration(bookId)
  const chapterBodies = new Map<number, string>()

  const shouldStop = () =>
    isBookGenerationCancelled(bookId) || !findLibraryBookById(readBooksStore(), bookId)

  const publishLiveCharacterCount = (pendingLine = '', draftingIndex?: number) => {
    publishBookGenerationProgress(bookId, {
      count: estimateLiveChapterCharacterCount(chapterBodies, pendingLine, draftingIndex),
      phase: 'writing',
    })
  }

  const markBookFailed = () => {
    if (shouldStop()) {
      return
    }
    let store = readBooksStore()
    store = updateBookInLibrary(store, bookId, { status: 'failed' })
    writeBooksStore(store)
  }

  try {
    const total = detail.chapterOutline.length
    const template = pickGenreTemplateForBook(listing.category, listing.slug)
    const templateBlock = formatGenreTemplateForPrompt(template)

    const persistChapter = async (index: number, title: string, body: string) => {
      if (shouldStop()) {
        return
      }

      chapterBodies.set(index, body)

      const chapterId = createChapterId()
      await saveBookChapterOrThrow({
        bookId,
        chapterId,
        index,
        title,
        body,
      })

      if (shouldStop()) {
        return
      }

      let store = readBooksStore()
      store = appendChapterIndex(store, bookId, { id: chapterId, index, title })
      store = updateBookInLibrary(store, bookId, {
        status: index >= total ? 'complete' : 'generating',
      })
      writeBooksStore(store)
      onChapterSaved(index, total)
      publishLiveCharacterCount()
    }

    if (!hasOpenAiApiKey()) {
      const store = readBooksStore()
      const book = findLibraryBookById(store, bookId)
      if (!book) {
        return
      }
      const seeds = buildSeedChapters(book)
      for (const chapter of seeds) {
        if (shouldStop()) {
          return
        }
        await persistChapter(chapter.index, chapter.title, chapter.body)
      }
      if (shouldStop()) {
        return
      }
      let nextStore = readBooksStore()
      nextStore = updateBookInLibrary(nextStore, bookId, { status: 'complete' })
      writeBooksStore(nextStore)
      return
    }

    try {
      for (let chapterIndex = 1; chapterIndex <= total; chapterIndex += 1) {
        if (shouldStop()) {
          return
        }

        const currentBook = findLibraryBookById(readBooksStore(), bookId)
        if (currentBook?.chapters.some((chapter) => chapter.index === chapterIndex)) {
          const existing = currentBook.chapters.find((chapter) => chapter.index === chapterIndex)
          if (existing) {
            const body = await loadChapterBody(bookId, existing.id)
            if (body) {
              chapterBodies.set(chapterIndex, body)
              publishLiveCharacterCount()
            }
          }
          continue
        }

        publishBookGenerationProgress(bookId, { phase: 'connecting' })

        let chapter: ReturnType<typeof normalizeChapter>
        try {
          chapter = await generateOneChapterStreaming(
            bookId,
            listing,
            detail,
            chapterIndex,
            templateBlock,
            chapterBodies,
            publishLiveCharacterCount,
          )
        } catch (error) {
          if (shouldStop()) {
            return
          }
          if (isStreamIdleTimeoutError(error)) {
            markBookFailed()
            return
          }
          throw error
        }

        if (!chapter) {
          markBookFailed()
          return
        }

        try {
          await persistChapter(chapter.index, chapter.title, chapter.body)
        } catch {
          markBookFailed()
          return
        }
      }

      if (shouldStop()) {
        return
      }

      let store = readBooksStore()
      const book = findLibraryBookById(store, bookId)
      const completed = book ? book.chapters.length >= total : false
      store = updateBookInLibrary(store, bookId, {
        status: completed ? 'complete' : 'failed',
      })
      writeBooksStore(store)
    } catch {
      if (shouldStop()) {
        return
      }
      const store = readBooksStore()
      const book = findLibraryBookById(store, bookId)
      if (book && book.chapters.length === 0) {
        const seeds = buildSeedChapters(book)
        for (const chapter of seeds) {
          if (shouldStop()) {
            return
          }
          await persistChapter(chapter.index, chapter.title, chapter.body)
        }
        if (shouldStop()) {
          return
        }
        let nextStore = readBooksStore()
        nextStore = updateBookInLibrary(nextStore, bookId, { status: 'complete' })
        writeBooksStore(nextStore)
      } else {
        markBookFailed()
      }
    }
  } finally {
    endBookGeneration(bookId)
  }
}

export async function seedBookContent(book: BookRecordMeta): Promise<void> {
  const seeds = buildSeedChapters(book)
  for (const chapter of seeds) {
    const chapterId = createChapterId()
    await saveBookChapterOrThrow({
      bookId: book.id,
      chapterId,
      index: chapter.index,
      title: chapter.title,
      body: chapter.body,
    })
    let store = readBooksStore()
    store = appendChapterIndex(store, book.id, {
      id: chapterId,
      index: chapter.index,
      title: chapter.title,
    })
    writeBooksStore(store)
  }
  let store = readBooksStore()
  store = updateBookInLibrary(store, book.id, { status: 'complete' })
  writeBooksStore(store)
}
