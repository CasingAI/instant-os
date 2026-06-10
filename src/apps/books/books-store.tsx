import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BooksCover, listingToCoverProps } from './books-cover.tsx'
import { normalizeBookCategory } from './books-genre-templates.ts'
import { BOOK_CATEGORIES, type BookCategory, type BookListing } from './books-types.ts'

type BooksStoreViewProps = {
  catalog: BookListing[]
  librarySlugs: ReadonlySet<string>
  isLoading: boolean
  categoryLoading?: string
  onEnsureCategory: (category: BookCategory) => void
  onOpenListing: (slug: string) => void
}

export function BooksStoreView({
  catalog,
  librarySlugs,
  isLoading,
  categoryLoading,
  onEnsureCategory,
  onOpenListing,
}: BooksStoreViewProps) {
  const [category, setCategory] = useState<string>('全部')
  const inFlightCategoryRef = useRef<string | undefined>()

  const filtered = useMemo(() => {
    if (category === '全部') {
      return catalog
    }
    return catalog.filter((item) => normalizeBookCategory(item.category) === category)
  }, [catalog, category])

  useEffect(() => {
    if (category === '全部' || isLoading || categoryLoading) {
      return
    }
    if (filtered.length > 0) {
      return
    }
    if (inFlightCategoryRef.current === category) {
      return
    }
    inFlightCategoryRef.current = category
    onEnsureCategory(category as BookCategory)
  }, [catalog.length, category, categoryLoading, filtered.length, isLoading, onEnsureCategory])

  useEffect(() => {
    if (!categoryLoading) {
      inFlightCategoryRef.current = undefined
    }
  }, [categoryLoading])

  const showLoading =
    (isLoading && catalog.length === 0) ||
    (category !== '全部' && filtered.length === 0 && categoryLoading === category)

  return (
    <div class="books-store">
      <div class="books-store__categories">
        <button
          type="button"
          class={`books-store__chip${category === '全部' ? ' books-store__chip--active' : ''}`}
          onClick={() => setCategory('全部')}
        >
          全部
        </button>
        {BOOK_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            class={`books-store__chip${category === item ? ' books-store__chip--active' : ''}`}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div class="books-store__list">
        {showLoading ? (
          <div class="books-store__loading">
            <div class="books-store__spinner" />
            <p>{category === '全部' ? '正在加载书城…' : `正在加载「${category}」…`}</p>
          </div>
        ) : (
          <div class="books-store__grid">
            {filtered.map((listing) => (
              <button
                key={listing.slug}
                type="button"
                class="books-store__card"
                onClick={() => onOpenListing(listing.slug)}
              >
                <BooksCover {...listingToCoverProps(listing)} size="small" />
                <div class="books-store__card-body">
                  <span class="books-store__badge">{listing.category}</span>
                  <span class="books-store__card-title">{listing.title}</span>
                  <span class="books-store__card-author">{listing.author}</span>
                  <span class="books-store__card-synopsis">{listing.synopsis}</span>
                  {librarySlugs.has(listing.slug) && (
                    <span class="books-store__badge">已在书架</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
