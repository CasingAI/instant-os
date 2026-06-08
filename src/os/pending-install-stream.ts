export type PendingInstallStreamSnapshot = {
  reasoningText: string
  rawText: string
}

const streams = new Map<string, PendingInstallStreamSnapshot>()
const slugListeners = new Map<string, Set<() => void>>()

const emptySnapshot = (): PendingInstallStreamSnapshot => ({
  reasoningText: '',
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

export function setPendingInstallStream(
  slug: string,
  patch: Partial<PendingInstallStreamSnapshot>,
): void {
  const previous = streams.get(slug) ?? emptySnapshot()
  streams.set(slug, {
    reasoningText: patch.reasoningText ?? previous.reasoningText,
    rawText: patch.rawText ?? previous.rawText,
  })
  notifySlug(slug)
}

export function getPendingInstallStream(slug: string): PendingInstallStreamSnapshot {
  return streams.get(slug) ?? emptySnapshot()
}

export function clearPendingInstallStream(slug: string): void {
  slugListeners.delete(slug)
  if (!streams.delete(slug)) {
    return
  }
}

export function subscribePendingInstallStream(
  slug: string,
  listener: () => void,
): () => void {
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

export function getPendingInstallStreamSnapshot(
  slug: string,
): PendingInstallStreamSnapshot {
  return getPendingInstallStream(slug)
}
