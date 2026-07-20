type MountDisconnectedNotificationListener = () => void

export type ActiveMountDisconnectedNotification = {
  label: string
}

const listeners = new Set<MountDisconnectedNotificationListener>()

let active: ActiveMountDisconnectedNotification | undefined

function notifySubscribers() {
  for (const listener of listeners) {
    listener()
  }
}

export function getActiveMountDisconnectedNotification():
  | ActiveMountDisconnectedNotification
  | undefined {
  return active
}

export function activateMountDisconnectedNotification(label: string): void {
  active = { label }
  notifySubscribers()
}

export function dismissMountDisconnectedNotification(): void {
  if (!active) {
    return
  }
  active = undefined
  notifySubscribers()
}

export function subscribeMountDisconnectedNotification(
  listener: MountDisconnectedNotificationListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
