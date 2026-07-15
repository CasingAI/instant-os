import { useEffect, useReducer } from 'preact/hooks'
import {
  getActiveStorageWarningNotification,
  subscribeStorageWarningNotification,
  type ActiveStorageWarningNotification,
} from './storage-warning-notification-store.ts'

export function useStorageWarningNotification(): ActiveStorageWarningNotification | undefined {
  const [, rerender] = useReducer((value: number) => value + 1, 0)

  useEffect(() => subscribeStorageWarningNotification(() => rerender(0)), [])

  return getActiveStorageWarningNotification()
}
