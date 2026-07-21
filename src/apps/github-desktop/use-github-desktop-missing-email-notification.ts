import { useEffect, useReducer } from 'preact/hooks'
import {
  isGithubDesktopMissingEmailNotificationActive,
  subscribeGithubDesktopMissingEmailNotification,
} from './github-desktop-missing-email-notification-store.ts'

export function useGithubDesktopMissingEmailNotification(): boolean {
  const [, rerender] = useReducer((value: number) => value + 1, 0)

  useEffect(() => subscribeGithubDesktopMissingEmailNotification(() => rerender(0)), [])

  return isGithubDesktopMissingEmailNotificationActive()
}
