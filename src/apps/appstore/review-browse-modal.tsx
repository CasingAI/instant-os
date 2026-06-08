import { useEffect, useState } from 'preact/hooks'
import { ReviewCard } from './review-card.tsx'
import type { StoreReview } from './types.ts'

type ReviewBrowseModalProps = {
  reviews: StoreReview[]
  onClose: () => void
  onDeleteUserReview?: (reviewId: string) => void
}

export function ReviewBrowseModal({ reviews, onClose, onDeleteUserReview }: ReviewBrowseModalProps) {
  const [index, setIndex] = useState(0)
  const total = reviews.length
  const review = reviews[index]

  useEffect(() => {
    if (index >= total) {
      setIndex(Math.max(0, total - 1))
    }
  }, [index, total])

  const goPrev = () => setIndex((current) => (current <= 0 ? total - 1 : current - 1))
  const goNext = () => setIndex((current) => (current >= total - 1 ? 0 : current + 1))

  if (!review) {
    return undefined
  }

  return (
    <div class="appstore-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        class="appstore-modal appstore-modal--browse"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appstore-review-browse-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="appstore-modal__header">
          <h2 class="appstore-modal__title" id="appstore-review-browse-title">
            全部评论
          </h2>
          <button type="button" class="appstore-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div class="appstore-modal__body appstore-modal__body--browse">
          <ReviewCard
            review={review}
            onDelete={
              review.isUser && onDeleteUserReview
                ? () => onDeleteUserReview(review.id)
                : undefined
            }
          />
        </div>

        <footer class="appstore-modal__footer appstore-modal__footer--browse">
          <button type="button" class="appstore-modal__pager" onClick={goPrev} aria-label="上一条">
            ‹
          </button>
          <span class="appstore-modal__pager-meta">
            {index + 1} / {total}
          </span>
          <button type="button" class="appstore-modal__pager" onClick={goNext} aria-label="下一条">
            ›
          </button>
        </footer>
      </div>
    </div>
  )
}
