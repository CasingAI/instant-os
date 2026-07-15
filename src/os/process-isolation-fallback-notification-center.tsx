import { IosNavBackButton } from '../ui/ios-nav-back-button.tsx'
import { patchExperimentalSettings } from './experimental-settings-storage.ts'
import { ProcessIsolationFallbackEmoji } from './process-isolation-fallback-emoji.tsx'
import { dismissProcessIsolationFallbackNotification } from './process-isolation-fallback-notification-store.ts'
import { NOTIFICATION_CENTER_SCREEN_FADE_MS } from './notification-center-store.ts'
import { PROCESS_ISOLATION_FALLBACK_COPY } from './process-isolation-fallback.ts'

function dismissProcessIsolationFallbackAfterTransition(): void {
  window.setTimeout(() => {
    dismissProcessIsolationFallbackNotification()
  }, NOTIFICATION_CENTER_SCREEN_FADE_MS)
}

type ProcessIsolationFallbackListItemProps = {
  onSelect: () => void
}

export function ProcessIsolationFallbackListItem({ onSelect }: ProcessIsolationFallbackListItemProps) {
  return (
    <button
      type="button"
      class="notification-center__item notification-center__item--warning"
      onClick={onSelect}
    >
      <ProcessIsolationFallbackEmoji variant="list" />
      <span class="notification-center__item-copy">
        <span class="notification-center__item-title">
          {PROCESS_ISOLATION_FALLBACK_COPY.listTitle}
        </span>
        <span class="notification-center__item-subtitle">
          {PROCESS_ISOLATION_FALLBACK_COPY.listSubtitle}
        </span>
      </span>
    </button>
  )
}

type ProcessIsolationFallbackDetailProps = {
  onBack: () => void
  onDismiss: () => void
}

export function ProcessIsolationFallbackDetail({
  onBack,
  onDismiss,
}: ProcessIsolationFallbackDetailProps) {
  const handleDisable = () => {
    patchExperimentalSettings({ generatedAppProcessIsolation: false })
    onDismiss()
    dismissProcessIsolationFallbackAfterTransition()
  }

  const handleIgnore = () => {
    onDismiss()
    dismissProcessIsolationFallbackAfterTransition()
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
      <div class="notification-center__detail-card notification-center__detail-card--warning">
        <div class="notification-center__detail-hero">
          <ProcessIsolationFallbackEmoji variant="detail" />
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">
              {PROCESS_ISOLATION_FALLBACK_COPY.detailTitle}
            </p>
            <p class="notification-center__detail-phase notification-center__detail-phase--warning">
              {PROCESS_ISOLATION_FALLBACK_COPY.listSubtitle}
            </p>
          </div>
        </div>
        <p class="notification-center__detail-error notification-center__detail-body">
          {PROCESS_ISOLATION_FALLBACK_COPY.detailBody}
        </p>
        <div class="notification-center__detail-actions">
          <button
            type="button"
            class="notification-center__action notification-center__action--primary"
            onClick={handleDisable}
          >
            {PROCESS_ISOLATION_FALLBACK_COPY.disableButton}
          </button>
          <button type="button" class="notification-center__action" onClick={handleIgnore}>
            {PROCESS_ISOLATION_FALLBACK_COPY.dismissButton}
          </button>
        </div>
      </div>
    </div>
  )
}
