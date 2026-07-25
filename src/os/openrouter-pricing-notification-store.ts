export const OPENROUTER_PRICING_NOTIFICATION_SLUG = 'system:openrouter-pricing'

export type OpenRouterPricingNotificationPhase =
  | 'running'
  | 'success'
  | 'failure'

export type OpenRouterPricingNotification = {
  phase: OpenRouterPricingNotificationPhase
  current: number
  total: number
  message: string
  error?: string
}

type Listener = () => void

const listeners = new Set<Listener>()
let active: OpenRouterPricingNotification | undefined

function notifySubscribers() {
  for (const listener of listeners) {
    listener()
  }
}

export function getOpenRouterPricingNotification():
  | OpenRouterPricingNotification
  | undefined {
  return active
}

export function setOpenRouterPricingNotification(
  notification: OpenRouterPricingNotification,
): void {
  active = notification
  notifySubscribers()
}

export function dismissOpenRouterPricingNotification(): void {
  if (!active) return
  active = undefined
  notifySubscribers()
}

export function subscribeOpenRouterPricingNotification(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
