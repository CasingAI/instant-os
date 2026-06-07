import type { StoreReview } from './types.ts'

export function formatReviewStars(rating: number): string {
  const clamped = Math.max(1, Math.min(5, Math.round(rating)))
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped)
}

/** 用户最新一条置顶，其余保持原顺序 */
export function sortReviewsForDisplay(reviews: StoreReview[]): StoreReview[] {
  if (reviews.length <= 1) {
    return reviews
  }

  let latestUser: StoreReview | undefined
  for (const review of reviews) {
    if (!review.isUser) {
      continue
    }
    if (!latestUser || review.createdAt > latestUser.createdAt) {
      latestUser = review
    }
  }

  if (!latestUser) {
    return reviews
  }

  return [latestUser, ...reviews.filter((review) => review.id !== latestUser.id)]
}
