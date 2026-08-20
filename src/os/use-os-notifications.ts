import { useEffect, useReducer } from 'preact/hooks'
import { getOsNotifications, subscribeOsNotifications } from './os-notifications.ts'

export function useOsNotifications() {
  const [, rerender] = useReducer((value: number) => value + 1, 0)
  useEffect(() => subscribeOsNotifications(() => rerender(0)), [])
  return getOsNotifications()
}
