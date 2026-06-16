type NotificationPanelScreen = 'list' | 'detail'

export const NOTIFICATION_CENTER_SCREEN_FADE_MS = 180

export type NotificationCenterStoreState = {
  isOpen: boolean
  panelScreen: NotificationPanelScreen
  selectedSlug: string | undefined
}

type NotificationCenterStoreListener = () => void

const INITIAL_STATE: NotificationCenterStoreState = {
  isOpen: false,
  panelScreen: 'list',
  selectedSlug: undefined,
}

const listeners = new Set<NotificationCenterStoreListener>()

let state: NotificationCenterStoreState = INITIAL_STATE

function notifyNotificationCenterStoreChange() {
  for (const listener of listeners) {
    listener()
  }
}

export function getNotificationCenterStoreState(): NotificationCenterStoreState {
  return state
}

export function setNotificationCenterStoreState(
  next: NotificationCenterStoreState | ((current: NotificationCenterStoreState) => NotificationCenterStoreState),
) {
  const resolved = typeof next === 'function' ? next(state) : next
  if (
    resolved.isOpen === state.isOpen &&
    resolved.panelScreen === state.panelScreen &&
    resolved.selectedSlug === state.selectedSlug
  ) {
    return
  }
  state = resolved
  notifyNotificationCenterStoreChange()
}

export function subscribeNotificationCenterStore(listener: NotificationCenterStoreListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
