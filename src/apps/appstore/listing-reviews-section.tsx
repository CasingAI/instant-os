import { useMemo } from 'preact/hooks'
import { ReviewCard } from './review-card.tsx'
import { sortReviewsForDisplay } from './review-display.ts'
import type { StoreReview } from './types.ts'

type ListingReviewsSectionProps = {
  reviews: StoreReview[]
  reviewsStreaming: boolean
  reviewsError: string | undefined
  installed: boolean
  onOpenBrowse: () => void
  onOpenCompose: () => void
  onDeleteUserReview?: (reviewId: string) => void
}

export function ListingReviewsSection({
  reviews,
  reviewsStreaming,
  reviewsError,
  installed,
  onOpenBrowse,
  onOpenCompose,
  onDeleteUserReview,
}: ListingReviewsSectionProps) {
  const sortedReviews = useMemo(() => sortReviewsForDisplay(reviews), [reviews])
  const canBrowse = sortedReviews.length > 1

  return (
    <section class="appstore-detail__section appstore-detail__section--reviews">
      <div class="appstore-detail__section-head">
        <h3 class="appstore-detail__section-title">评论</h3>
        {canBrowse && (
          <button type="button" class="appstore-detail__section-link" onClick={onOpenBrowse}>
            查看更多评论
          </button>
        )}
      </div>

      {reviewsError && (
        <div class="appstore__notice appstore__notice--error appstore-detail__notice">{reviewsError}</div>
      )}

      {reviewsStreaming && sortedReviews.length === 0 ? (
        <div class="appstore-detail__reviews-rail">
          <div class="appstore-review-card appstore-review-card--compact appstore-review-card--skeleton" />
          <div class="appstore-review-card appstore-review-card--compact appstore-review-card--skeleton" />
        </div>
      ) : sortedReviews.length === 0 ? (
        <p class="appstore-detail__reviews-empty">暂无评论</p>
      ) : (
        <div class="appstore-detail__reviews-rail" tabindex={0}>
          {sortedReviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              compact
              onDelete={
                review.isUser && onDeleteUserReview
                  ? () => onDeleteUserReview(review.id)
                  : undefined
              }
            />
          ))}
          {reviewsStreaming && (
            <div class="appstore-review-card appstore-review-card--compact appstore-review-card--skeleton" />
          )}
        </div>
      )}

      {installed && (
        <button type="button" class="appstore-detail__write-review" onClick={onOpenCompose}>
          写评论
        </button>
      )}
    </section>
  )
}
