import { useEffect, useReducer } from 'preact/hooks'
import {
  isProcessIsolationFallbackNotificationActive,
  subscribeProcessIsolationFallbackNotification,
} from './process-isolation-fallback-notification-store.ts'

export function useProcessIsolationFallbackNotification(): boolean {
  const [, rerender] = useReducer((value: number) => value + 1, 0)

  useEffect(() => subscribeProcessIsolationFallbackNotification(() => rerender(0)), [])

  return isProcessIsolationFallbackNotificationActive()
}
