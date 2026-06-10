type BooksDeleteConfirmSheetProps = {
  bookTitle: string
  onCancel: () => void
  onConfirm: () => void
}

export function BooksDeleteConfirmSheet({
  bookTitle,
  onCancel,
  onConfirm,
}: BooksDeleteConfirmSheetProps) {
  return (
    <div class="books-confirm-backdrop" role="presentation" onClick={onCancel}>
      <div
        class="books-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="books-delete-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="books-confirm__body">
          <div class="books-confirm__icon" aria-hidden="true">
            !
          </div>
          <div class="books-confirm__copy">
            <h3 class="books-confirm__title" id="books-delete-confirm-title">
              从书架移除此书？
            </h3>
            <p class="books-confirm__message">
              「{bookTitle}」将从书架移除，已下载的章节正文也会被删除。书城详情缓存会保留。
            </p>
          </div>
        </div>
        <div class="books-confirm__actions">
          <button type="button" class="books-confirm__btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            class="books-confirm__btn books-confirm__btn--danger"
            onClick={onConfirm}
          >
            移除
          </button>
        </div>
      </div>
    </div>
  )
}
