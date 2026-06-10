export const BOOK_GENERATION_PROGRESS_EVENT = 'instant-os:books-generation-progress'

export type BookGenerationPhase = 'connecting' | 'thinking' | 'writing'

export type BookGenerationProgressDetail = {
  bookId: string
  count: number
  phase: BookGenerationPhase
  lastActivityAt: number
}

type ActiveBookGenerationJob = {
  cancelled: boolean
  liveCharacterCount: number
  lastActivityAt: number
  phase: BookGenerationPhase
}

const activeJobs = new Map<string, ActiveBookGenerationJob>()

function dispatchProgress(bookId: string): void {
  const job = activeJobs.get(bookId)
  if (!job || typeof window === 'undefined') {
    return
  }
  const detail: BookGenerationProgressDetail = {
    bookId,
    count: job.liveCharacterCount,
    phase: job.phase,
    lastActivityAt: job.lastActivityAt,
  }
  window.dispatchEvent(new CustomEvent(BOOK_GENERATION_PROGRESS_EVENT, { detail }))
}

export function beginBookGeneration(bookId: string): void {
  const now = Date.now()
  activeJobs.set(bookId, {
    cancelled: false,
    liveCharacterCount: 0,
    lastActivityAt: now,
    phase: 'connecting',
  })
  dispatchProgress(bookId)
}

export function cancelBookGeneration(bookId: string): void {
  const job = activeJobs.get(bookId)
  if (job) {
    job.cancelled = true
  }
}

export function isBookGenerationCancelled(bookId: string): boolean {
  return activeJobs.get(bookId)?.cancelled ?? false
}

export function isBookGenerationActive(bookId: string): boolean {
  return activeJobs.has(bookId)
}

export function getBookGenerationLiveCharacterCount(bookId: string): number {
  return activeJobs.get(bookId)?.liveCharacterCount ?? 0
}

export function getBookGenerationActivity(bookId: string): {
  phase: BookGenerationPhase
  lastActivityAt: number
} {
  const job = activeJobs.get(bookId)
  if (!job) {
    return { phase: 'connecting', lastActivityAt: 0 }
  }
  return { phase: job.phase, lastActivityAt: job.lastActivityAt }
}

export function publishBookGenerationProgress(
  bookId: string,
  patch: {
    count?: number
    phase?: BookGenerationPhase
  },
): void {
  const job = activeJobs.get(bookId)
  if (!job) {
    return
  }
  if (patch.count !== undefined) {
    job.liveCharacterCount = patch.count
  }
  if (patch.phase !== undefined) {
    job.phase = patch.phase
  }
  job.lastActivityAt = Date.now()
  dispatchProgress(bookId)
}

/** @deprecated use publishBookGenerationProgress */
export function setBookGenerationLiveCharacterCount(bookId: string, count: number): void {
  publishBookGenerationProgress(bookId, { count, phase: 'writing' })
}

export function endBookGeneration(bookId: string): void {
  activeJobs.delete(bookId)
}
