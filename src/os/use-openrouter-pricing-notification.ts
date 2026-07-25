import { useEffect, useState } from 'preact/hooks'
import {
  getOpenRouterPricingNotification,
  subscribeOpenRouterPricingNotification,
  type OpenRouterPricingNotification,
} from './openrouter-pricing-notification-store.ts'

export function useOpenRouterPricingNotification():
  | OpenRouterPricingNotification
  | undefined {
  const [notification, setNotification] = useState<
    OpenRouterPricingNotification | undefined
  >(() => getOpenRouterPricingNotification())

  useEffect(
    () =>
      subscribeOpenRouterPricingNotification(() => {
        setNotification(getOpenRouterPricingNotification())
      }),
    [],
  )

  return notification
}
