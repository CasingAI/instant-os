import { useEffect, useReducer } from 'preact/hooks'
import { getAppNotifications, subscribeAppNotifications } from './app-notifications-store.ts'

export function useAppNotifications() {
  const [, rerender] = useReducer((value: number) => value + 1, 0)

  useEffect(() => subscribeAppNotifications(() => rerender(0)), [])

  return getAppNotifications()
}
