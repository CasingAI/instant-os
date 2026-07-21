type Listener = () => void

const listeners = new Set<Listener>()

let active = false

function notifySubscribers() {
  for (const listener of listeners) {
    listener()
  }
}

export function isGithubDesktopMissingEmailNotificationActive(): boolean {
  return active
}

export function activateGithubDesktopMissingEmailNotification(): void {
  if (active) return
  active = true
  notifySubscribers()
}

export function dismissGithubDesktopMissingEmailNotification(): void {
  if (!active) return
  active = false
  notifySubscribers()
}

export function subscribeGithubDesktopMissingEmailNotification(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
