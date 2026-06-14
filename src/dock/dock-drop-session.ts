export type DockDropSession = {
  active: boolean
  insertIndex: number | undefined
}

const EMPTY_SESSION: DockDropSession = {
  active: false,
  insertIndex: undefined,
}

type DockDropSessionListener = () => void
const listeners = new Set<DockDropSessionListener>()

let session: DockDropSession = EMPTY_SESSION

function notifyDockDropSessionChange() {
  for (const listener of listeners) {
    listener()
  }
}

export function getDockDropSession(): DockDropSession {
  return session
}

export function setDockDropSession(next: DockDropSession): void {
  session = next
  notifyDockDropSessionChange()
}

export function clearDockDropSession(): void {
  if (!session.active && session.insertIndex === undefined) {
    return
  }
  session = EMPTY_SESSION
  notifyDockDropSessionChange()
}

export function subscribeDockDropSession(listener: DockDropSessionListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
