import { IosNavBackButton } from '../ui/ios-nav-back-button.tsx'
import { dismissMountDisconnectedNotification } from './mount-disconnected-notification-store.ts'
import { NOTIFICATION_CENTER_SCREEN_FADE_MS } from './notification-center-store.ts'
import {
  detailBodyForMountDisconnected,
  messageForMountDisconnected,
  MOUNT_DISCONNECTED_COPY,
} from './mount-disconnected.ts'

function dismissMountDisconnectedAfterTransition(): void {
  window.setTimeout(() => {
    dismissMountDisconnectedNotification()
  }, NOTIFICATION_CENTER_SCREEN_FADE_MS)
}

type MountDisconnectedListItemProps = {
  label: string
  onSelect: () => void
}

export function MountDisconnectedListItem({ label, onSelect }: MountDisconnectedListItemProps) {
  const { title, subtitle } = messageForMountDisconnected(label)

  return (
    <button
      type="button"
      class="notification-center__item notification-center__item--warning"
      onClick={onSelect}
    >
      <span class="notification-center__item-icon" aria-hidden="true">
        ⏏
      </span>
      <span class="notification-center__item-copy">
        <span class="notification-center__item-title">{title}</span>
        <span class="notification-center__item-subtitle">{subtitle}</span>
      </span>
    </button>
  )
}

type MountDisconnectedDetailProps = {
  label: string
  onBack: () => void
  onDismiss: () => void
}

export function MountDisconnectedDetail({
  label,
  onBack,
  onDismiss,
}: MountDisconnectedDetailProps) {
  const { title } = messageForMountDisconnected(label)

  const handleIgnore = () => {
    onDismiss()
    dismissMountDisconnectedAfterTransition()
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
          <span class="notification-center__item-icon" aria-hidden="true">
            ⏏
          </span>
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">{title}</p>
            <p class="notification-center__detail-phase notification-center__detail-phase--warning">
              容器已卸载
            </p>
          </div>
        </div>
        <p class="notification-center__detail-error notification-center__detail-body">
          {detailBodyForMountDisconnected(label)}
        </p>
        <div class="notification-center__detail-actions">
          <button type="button" class="notification-center__action" onClick={handleIgnore}>
            {MOUNT_DISCONNECTED_COPY.dismissButton}
          </button>
        </div>
      </div>
    </div>
  )
}
