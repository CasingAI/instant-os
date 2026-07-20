import { useEffect, useReducer } from 'preact/hooks'
import {
  getActiveMountDisconnectedNotification,
  subscribeMountDisconnectedNotification,
  type ActiveMountDisconnectedNotification,
} from './mount-disconnected-notification-store.ts'

export function useMountDisconnectedNotification():
  | ActiveMountDisconnectedNotification
  | undefined {
  const [, rerender] = useReducer((value: number) => value + 1, 0)

  useEffect(() => subscribeMountDisconnectedNotification(() => rerender(0)), [])

  return getActiveMountDisconnectedNotification()
}
