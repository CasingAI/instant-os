import { IosNavBackButton } from '../ui/ios-nav-back-button.tsx'
import { NOTIFICATION_CENTER_SCREEN_FADE_MS } from './notification-center-store.ts'
import {
  dismissOpenRouterPricingNotification,
  type OpenRouterPricingNotification,
} from './openrouter-pricing-notification-store.ts'

function dismissAfterTransition(): void {
  window.setTimeout(() => {
    dismissOpenRouterPricingNotification()
  }, NOTIFICATION_CENTER_SCREEN_FADE_MS)
}

function phaseLabel(notification: OpenRouterPricingNotification): string {
  if (notification.phase === 'running') {
    if (notification.total <= 0) return notification.message
    return `${notification.message}（${notification.current}/${notification.total}）`
  }
  if (notification.phase === 'success') return notification.message
  return notification.error ?? notification.message
}

type OpenRouterPricingListItemProps = {
  notification: OpenRouterPricingNotification
  onSelect: () => void
}

export function OpenRouterPricingListItem({
  notification,
  onSelect,
}: OpenRouterPricingListItemProps) {
  const progress =
    notification.phase === 'running' && notification.total > 0
      ? Math.round((notification.current / notification.total) * 100)
      : notification.phase === 'success'
        ? 100
        : undefined

  return (
    <button type="button" class="notification-center__item" onClick={onSelect}>
      <span class="notification-center__item-copy">
        <span class="notification-center__item-title">OpenRouter 模型定价</span>
        <span class="notification-center__item-subtitle">
          {phaseLabel(notification)}
        </span>
        {progress !== undefined && (
          <span class="notification-center__item-progress" aria-hidden="true">
            <span class="notification-center__item-progress-track">
              <span
                class="notification-center__item-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </span>
            <span class="notification-center__item-progress-value">{progress}%</span>
          </span>
        )}
      </span>
    </button>
  )
}

type OpenRouterPricingDetailProps = {
  notification: OpenRouterPricingNotification
  onBack: () => void
  onDismiss: () => void
}

export function OpenRouterPricingDetail({
  notification,
  onBack,
  onDismiss,
}: OpenRouterPricingDetailProps) {
  const progress =
    notification.phase === 'running' && notification.total > 0
      ? Math.round((notification.current / notification.total) * 100)
      : notification.phase === 'success'
        ? 100
        : 0
  const phaseClass =
    notification.phase === 'failure'
      ? 'notification-center__detail-phase--failed'
      : notification.phase === 'success'
        ? 'notification-center__detail-phase--complete'
        : undefined

  const handleDismiss = () => {
    onDismiss()
    dismissAfterTransition()
  }

  return (
    <div class="notification-center__detail">
      <div class="notification-center__detail-header">
        <IosNavBackButton
          label="返回通知"
          onClick={(event) => {
            event.stopPropagation()
            onBack()
          }}
        />
      </div>
      <div
        class={
          notification.phase === 'failure'
            ? 'notification-center__detail-card notification-center__detail-card--failed'
            : notification.phase === 'success'
              ? 'notification-center__detail-card notification-center__detail-card--complete'
              : 'notification-center__detail-card'
        }
      >
        <div class="notification-center__detail-hero">
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">OpenRouter 模型定价</p>
            <p class={['notification-center__detail-phase', phaseClass].filter(Boolean).join(' ')}>
              {phaseLabel(notification)}
            </p>
          </div>
        </div>
        {notification.total > 0 && (
          <div class="notification-center__detail-progress" aria-hidden="true">
            <span class="notification-center__detail-progress-track">
              <span
                class="notification-center__detail-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </span>
          </div>
        )}
        {notification.error && (
          <p class="notification-center__detail-error notification-center__detail-body">
            {notification.error}
          </p>
        )}
        {notification.phase !== 'running' && (
          <div class="notification-center__detail-actions">
            <button type="button" class="notification-center__action" onClick={handleDismiss}>
              清除
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
