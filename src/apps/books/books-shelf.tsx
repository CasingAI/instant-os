import { Button } from '../../ui/button.tsx'
import { BooksCover, listingToCoverProps } from './books-cover.tsx'
import { canOpenBook, getBookGenerationPercent } from './books-storage.ts'
import type { BookRecordMeta } from './books-types.ts'

type BooksShelfProps = {
  books: BookRecordMeta[]
  editing: boolean
  onOpenBook: (bookId: string) => void
  onOpenStoreListing: (slug: string) => void
  onDeleteBook: (bookId: string) => void
  onGoStore: () => void
}

export function BooksShelf({
  books,
  editing,
  onOpenBook,
  onOpenStoreListing,
  onDeleteBook,
  onGoStore,
}: BooksShelfProps) {
  if (books.length === 0) {
    return (
      <div class="books-shelf books-shelf--empty">
        <div class="books-shelf__empty">
          <p class="books-shelf__empty-text">当前还没有添加书籍</p>
          <Button onClick={onGoStore}>
            进入书城
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div class={`books-shelf${editing ? ' books-shelf--editing' : ''}`}>
      <div class="books-shelf__grid">
        {books.map((book, index) => {
          const progress = getBookGenerationPercent(book)
          const openable = canOpenBook(book)
          const failed = book.status === 'failed'
          const clickable = editing || openable || failed

          return (
            <div
              key={book.id}
              class="books-shelf__item-wrap"
            >
              {editing && (
                <button
                  type="button"
                  class="books-shelf__delete"
                  aria-label={`删除 ${book.title}`}
                  onClick={() => onDeleteBook(book.id)}
                >
                  <span class="books-shelf__delete-minus" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                class="books-shelf__item"
                onClick={() => {
                  if (editing) {
                    onDeleteBook(book.id)
                    return
                  }
                  if (openable) {
                    onOpenBook(book.id)
                    return
                  }
                  if (failed) {
                    onOpenStoreListing(book.slug)
                  }
                }}
                disabled={!clickable}
              >
                <div
                  class={`books-shelf__cover-wrap${editing ? ' books-shelf__cover-wrap--editing' : ''}`}
                  style={{ animationDelay: editing ? `${(index % 5) * 0.04}s` : undefined }}
                >
                  <BooksCover
                    {...listingToCoverProps(book)}
                    dimmed={!editing && !openable && !failed}
                    progress={progress}
                  />
                </div>
                <div class="books-shelf__meta">
                  <span class="books-shelf__item-title">{book.title}</span>
                  <span class="books-shelf__status">
                    {!editing && book.status === 'generating' && progress !== undefined
                      ? `${progress}%`
                      : !editing && book.status === 'failed'
                        ? '下载失败'
                        : ''}
                  </span>
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
