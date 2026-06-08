import { formatReviewStars } from './review-display.ts'
import type { StoreReview } from './types.ts'

type ReviewCardProps = {
  review: StoreReview
  compact?: boolean
  onDelete?: () => void
}

function ReviewDeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      type="button"
      class="appstore-review-card__delete"
      onClick={(event) => {
        event.stopPropagation()
        onDelete()
      }}
      aria-label="删除评论"
    >
      删除
    </button>
  )
}

export function ReviewCard({ review, compact = false, onDelete }: ReviewCardProps) {
  const deleteAction = review.isUser && onDelete ? onDelete : undefined

  if (compact) {
    return (
      <article
        class={`appstore-review-card appstore-review-card--compact${review.isUser ? ' appstore-review-card--user' : ''}`}
      >
        <div class="appstore-review-card__head">
          <span class="appstore-review-card__author">{review.isUser ? '我的评论' : review.author}</span>
          <div class="appstore-review-card__head-end">
            {deleteAction && <ReviewDeleteButton onDelete={deleteAction} />}
            <span class="appstore-review-card__stars" aria-label={`${review.rating} 星`}>
              {formatReviewStars(review.rating)}
            </span>
          </div>
        </div>
        <p class="appstore-review-card__body">{review.body}</p>
      </article>
    )
  }

  return (
    <article class={`appstore-review-card${review.isUser ? ' appstore-review-card--user' : ''}`}>
      <div class="appstore-review-card__head">
        <span class="appstore-review-card__author">{review.isUser ? '我的评论' : review.author}</span>
        <div class="appstore-review-card__head-end">
          {deleteAction && <ReviewDeleteButton onDelete={deleteAction} />}
          <span class="appstore-review-card__stars" aria-label={`${review.rating} 星`}>
            {formatReviewStars(review.rating)}
          </span>
        </div>
      </div>
      {review.isUser && (
        <p class="appstore-review-card__meta">针对 {review.version}</p>
      )}
      <p class="appstore-review-card__body appstore-review-card__body--full">{review.body}</p>
    </article>
  )
}
