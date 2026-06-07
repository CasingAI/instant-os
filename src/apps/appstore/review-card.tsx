import { formatReviewStars } from './review-display.ts'
import type { StoreReview } from './types.ts'

type ReviewCardProps = {
  review: StoreReview
  compact?: boolean
}

export function ReviewCard({ review, compact = false }: ReviewCardProps) {
  if (compact) {
    return (
      <article
        class={`appstore-review-card appstore-review-card--compact${review.isUser ? ' appstore-review-card--user' : ''}`}
      >
        <div class="appstore-review-card__head">
          <span class="appstore-review-card__author">{review.isUser ? '我的评论' : review.author}</span>
          <span class="appstore-review-card__stars" aria-label={`${review.rating} 星`}>
            {formatReviewStars(review.rating)}
          </span>
        </div>
        <p class="appstore-review-card__body">{review.body}</p>
      </article>
    )
  }

  return (
    <article class={`appstore-review-card${review.isUser ? ' appstore-review-card--user' : ''}`}>
      <div class="appstore-review-card__head">
        <span class="appstore-review-card__author">{review.isUser ? '我的评论' : review.author}</span>
        <span class="appstore-review-card__stars" aria-label={`${review.rating} 星`}>
          {formatReviewStars(review.rating)}
        </span>
      </div>
      {review.isUser && (
        <p class="appstore-review-card__meta">针对 {review.version}</p>
      )}
      <p class="appstore-review-card__body appstore-review-card__body--full">{review.body}</p>
    </article>
  )
}
