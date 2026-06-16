type ProcessIsolationFallbackNotificationListener = () => void

const listeners = new Set<ProcessIsolationFallbackNotificationListener>()

let active = false

function notifySubscribers() {
  for (const listener of listeners) {
    listener()
  }
}

export function isProcessIsolationFallbackNotificationActive(): boolean {
  return active
}

export function activateProcessIsolationFallbackNotification(): void {
  if (active) {
    return
  }
  active = true
  notifySubscribers()
}

export function dismissProcessIsolationFallbackNotification(): void {
  if (!active) {
    return
  }
  active = false
  notifySubscribers()
}

export function subscribeProcessIsolationFallbackNotification(
  listener: ProcessIsolationFallbackNotificationListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
