import { StoragePaneIcon } from '../apps/settings/settings-pane-icons.tsx'
import { IosNavBackButton } from '../ui/ios-nav-back-button.tsx'
import { useOs } from './os-context.tsx'
import { NOTIFICATION_CENTER_SCREEN_FADE_MS } from './notification-center-store.ts'
import { dismissStorageWarningNotification } from './storage-warning-notification-store.ts'
import {
  messageForStorageWarning,
  openSettingsUsageView,
  type StorageWarningLevel,
  type StorageWarningScope,
} from './storage-warning.ts'

function dismissStorageWarningAfterTransition(): void {
  window.setTimeout(() => {
    dismissStorageWarningNotification()
  }, NOTIFICATION_CENTER_SCREEN_FADE_MS)
}

type StorageWarningListItemProps = {
  level: StorageWarningLevel
  scope: StorageWarningScope
  onSelect: () => void
}

export function StorageWarningListItem({ level, scope, onSelect }: StorageWarningListItemProps) {
  const { title, subtitle } = messageForStorageWarning(level, scope)

  return (
    <button
      type="button"
      class="notification-center__item notification-center__item--warning"
      onClick={onSelect}
    >
      <span class="notification-center__item-icon">
        <StoragePaneIcon />
      </span>
      <span class="notification-center__item-copy">
        <span class="notification-center__item-title">{title}</span>
        <span class="notification-center__item-subtitle">{subtitle}</span>
      </span>
    </button>
  )
}

type StorageWarningDetailProps = {
  level: StorageWarningLevel
  scope: StorageWarningScope
  onBack: () => void
  onDismiss: () => void
  onClose: () => void
}

export function StorageWarningDetail({
  level,
  scope,
  onBack,
  onDismiss,
  onClose,
}: StorageWarningDetailProps) {
  const { openApp } = useOs()
  const { title, subtitle } = messageForStorageWarning(level, scope)

  const handleOpenUsage = () => {
    openApp('settings')
    openSettingsUsageView()
    onClose()
    dismissStorageWarningAfterTransition()
  }

  const handleIgnore = () => {
    onDismiss()
    dismissStorageWarningAfterTransition()
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
          <span class="notification-center__item-icon">
            <StoragePaneIcon />
          </span>
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">{title}</p>
            <p class="notification-center__detail-phase notification-center__detail-phase--warning">
              {subtitle}
            </p>
          </div>
        </div>
        <div class="notification-center__detail-actions">
          <button
            type="button"
            class="notification-center__action notification-center__action--primary"
            onClick={handleOpenUsage}
          >
            查看用量
          </button>
          <button type="button" class="notification-center__action" onClick={handleIgnore}>
            忽略
          </button>
        </div>
      </div>
    </div>
  )
}
