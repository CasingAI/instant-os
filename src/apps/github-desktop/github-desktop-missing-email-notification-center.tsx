import { GithubDesktopIcon } from '../../icons/app-icons.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { useOs } from '../../os/os-context.tsx'
import { NOTIFICATION_CENTER_SCREEN_FADE_MS } from '../../os/notification-center-store.ts'
import { dismissGithubDesktopMissingEmailNotification } from './github-desktop-missing-email-notification-store.ts'
import {
  GITHUB_DESKTOP_MISSING_EMAIL_COPY,
  messageForGithubDesktopMissingEmail,
  openGithubDesktopGitPrefs,
} from './github-desktop-missing-email.ts'

function dismissAfterTransition(): void {
  window.setTimeout(() => {
    dismissGithubDesktopMissingEmailNotification()
  }, NOTIFICATION_CENTER_SCREEN_FADE_MS)
}

type ListItemProps = {
  onSelect: () => void
}

export function GithubDesktopMissingEmailListItem({ onSelect }: ListItemProps) {
  const { title, subtitle } = messageForGithubDesktopMissingEmail()

  return (
    <button
      type="button"
      class="notification-center__item notification-center__item--warning"
      onClick={onSelect}
    >
      <span class="notification-center__item-icon">
        <GithubDesktopIcon size={29} />
      </span>
      <span class="notification-center__item-copy">
        <span class="notification-center__item-title">{title}</span>
        <span class="notification-center__item-subtitle">{subtitle}</span>
      </span>
    </button>
  )
}

type DetailProps = {
  onBack: () => void
  onDismiss: () => void
  onClose: () => void
}

export function GithubDesktopMissingEmailDetail({ onBack, onDismiss, onClose }: DetailProps) {
  const { openApp } = useOs()
  const { title } = messageForGithubDesktopMissingEmail()

  const handleOpenSettings = () => {
    openApp('github-desktop')
    openGithubDesktopGitPrefs()
    onClose()
    dismissAfterTransition()
  }

  const handleIgnore = () => {
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
      <div class="notification-center__detail-card notification-center__detail-card--warning">
        <div class="notification-center__detail-hero">
          <span class="notification-center__item-icon">
            <GithubDesktopIcon size={29} />
          </span>
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">{title}</p>
            <p class="notification-center__detail-phase notification-center__detail-phase--warning">
              {GITHUB_DESKTOP_MISSING_EMAIL_COPY.detailPhase}
            </p>
          </div>
        </div>
        <p class="notification-center__detail-error notification-center__detail-body">
          {GITHUB_DESKTOP_MISSING_EMAIL_COPY.detailBody}
        </p>
        <div class="notification-center__detail-actions">
          <button
            type="button"
            class="notification-center__action notification-center__action--primary"
            onClick={handleOpenSettings}
          >
            {GITHUB_DESKTOP_MISSING_EMAIL_COPY.openSettingsButton}
          </button>
          <button type="button" class="notification-center__action" onClick={handleIgnore}>
            {GITHUB_DESKTOP_MISSING_EMAIL_COPY.dismissButton}
          </button>
        </div>
      </div>
    </div>
  )
}
