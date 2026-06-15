export type BookStreamSnapshot = {
  rawText: string
}

const streams = new Map<string, BookStreamSnapshot>()
const slugListeners = new Map<string, Set<() => void>>()

const emptySnapshot = (): BookStreamSnapshot => ({
  rawText: '',
})

function notifySlug(slug: string) {
  const listeners = slugListeners.get(slug)
  if (!listeners) {
    return
  }
  for (const listener of listeners) {
    listener()
  }
}

export function setBookStream(slug: string, patch: Partial<BookStreamSnapshot>): void {
  const previous = streams.get(slug) ?? emptySnapshot()
  streams.set(slug, {
    rawText: patch.rawText ?? previous.rawText,
  })
  notifySlug(slug)
}

export function getBookStream(slug: string): BookStreamSnapshot {
  return streams.get(slug) ?? emptySnapshot()
}

export function clearBookStream(slug: string): void {
  slugListeners.delete(slug)
  streams.delete(slug)
}

export function subscribeBookStream(slug: string, listener: () => void): () => void {
  let listeners = slugListeners.get(slug)
  if (!listeners) {
    listeners = new Set()
    slugListeners.set(slug, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) {
      slugListeners.delete(slug)
    }
  }
}
