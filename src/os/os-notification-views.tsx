import { AiStreamPreview } from '../ai/ai-stream-preview.tsx'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { getAppDefinition } from './app-registry.tsx'
import { IosNavBackButton } from '../ui/ios-nav-back-button.tsx'
import { useBookStream } from './use-book-stream.ts'
import { usePendingInstallStream } from './use-pending-install-stream.ts'
import {
  invokeOsNotificationAction,
  isOsNotificationDismissible,
  type OsNotification,
} from './os-notifications.ts'

export function OsNotificationIconView({
  notification,
  size,
}: {
  notification: OsNotification
  size: number
}) {
  const { icon } = notification
  if (icon.kind === 'app') {
    const definition = getAppDefinition(icon.appId)
    const Icon = definition?.icon
    if (!Icon) {
      return <span class="notification-center__item-icon" />
    }
    return (
      <span class="notification-center__item-icon">
        <Icon size={Math.round(size * 0.72)} />
      </span>
    )
  }

  const progress =
    notification.phase === 'running' ? notification.progress?.percent : undefined

  return (
    <span class="notification-center__item-icon">
      <GeneratedAppIcon
        emoji={icon.emoji}
        themeColor={icon.color}
        size={size}
        progress={progress}
        textLength={notification.progress?.textLength}
      />
    </span>
  )
}

function phaseClassName(notification: OsNotification): string | undefined {
  if (notification.phase === 'failure') return 'notification-center__item--failed'
  if (notification.phase === 'success') return 'notification-center__item--complete'
  if (notification.phase === 'warning') return 'notification-center__item--warning'
  return undefined
}

function detailCardClassName(notification: OsNotification): string {
  if (notification.phase === 'failure') {
    return 'notification-center__detail-card notification-center__detail-card--failed'
  }
  if (notification.phase === 'success') {
    return 'notification-center__detail-card notification-center__detail-card--complete'
  }
  if (notification.phase === 'warning') {
    return 'notification-center__detail-card notification-center__detail-card--warning'
  }
  return 'notification-center__detail-card'
}

function detailPhaseClassName(notification: OsNotification): string {
  if (notification.phase === 'failure') {
    return 'notification-center__detail-phase notification-center__detail-phase--failed'
  }
  if (notification.phase === 'success') {
    return 'notification-center__detail-phase notification-center__detail-phase--complete'
  }
  if (notification.phase === 'warning') {
    return 'notification-center__detail-phase notification-center__detail-phase--warning'
  }
  return 'notification-center__detail-phase'
}

export function OsNotificationListItem({
  notification,
  onSelect,
}: {
  notification: OsNotification
  onSelect: () => void
}) {
  const running = notification.phase === 'running'
  const percent = Math.round(notification.progress?.percent ?? 0)
  const extraClass = phaseClassName(notification)

  return (
    <button
      type="button"
      class={`notification-center__item${extraClass ? ` ${extraClass}` : ''}`}
      onClick={onSelect}
    >
      <OsNotificationIconView notification={notification} size={40} />
      <span class="notification-center__item-copy">
        <span class="notification-center__item-title">{notification.title}</span>
        <span class="notification-center__item-subtitle">{notification.subtitle}</span>
        {running && notification.progress && (
          <span class="notification-center__item-progress" aria-hidden="true">
            <span class="notification-center__item-progress-track">
              <span
                class="notification-center__item-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </span>
          </span>
        )}
      </span>
      {running && notification.progress && (
        <span class="notification-center__item-meta">{percent}%</span>
      )}
    </button>
  )
}

type IosStyleClearButtonProps = {
  clearId: string
  armedClearId: string | undefined
  setArmedClearId: (id: string | undefined) => void
  onConfirm: () => void
  confirmLabel: string
  className?: string
}

export function IosStyleClearButton({
  clearId,
  armedClearId,
  setArmedClearId,
  onConfirm,
  confirmLabel,
  className,
}: IosStyleClearButtonProps) {
  const armed = armedClearId === clearId

  return (
    <button
      type="button"
      data-ios-clear={clearId}
      class={`notification-center__ios-clear${armed ? ' notification-center__ios-clear--armed' : ''}${className ? ` ${className}` : ''}`}
      aria-label={armed ? confirmLabel : '准备清除'}
      aria-expanded={armed}
      onClick={(event) => {
        event.stopPropagation()
        if (armed) {
          setArmedClearId(undefined)
          onConfirm()
          return
        }
        setArmedClearId(clearId)
      }}
    >
      <span class="notification-center__ios-clear-glyph" aria-hidden="true" />
      <span class="notification-center__ios-clear-label" aria-hidden="true">
        {confirmLabel}
      </span>
    </button>
  )
}

export function OsNotificationListRow({
  notification,
  onSelect,
  onDismiss,
  armedClearId,
  setArmedClearId,
}: {
  notification: OsNotification
  onSelect: () => void
  onDismiss: () => void
  armedClearId: string | undefined
  setArmedClearId: (id: string | undefined) => void
}) {
  const dismissible = isOsNotificationDismissible(notification)
  if (!dismissible) {
    return <OsNotificationListItem notification={notification} onSelect={onSelect} />
  }

  return (
    <div class="notification-center__item-wrap">
      <OsNotificationListItem notification={notification} onSelect={onSelect} />
      <IosStyleClearButton
        clearId={notification.id}
        armedClearId={armedClearId}
        setArmedClearId={setArmedClearId}
        onConfirm={onDismiss}
        confirmLabel="清除"
      />
    </div>
  )
}

function OsNotificationStream({ notification }: { notification: OsNotification }) {
  const installStream = usePendingInstallStream(
    notification.streamKind === 'book' ? undefined : notification.streamSlug,
  )
  const bookStream = useBookStream(
    notification.streamKind === 'book' ? notification.streamSlug : undefined,
  )

  if (!notification.streamSlug) {
    return null
  }

  const reasoningText =
    notification.streamKind === 'book' ? '' : installStream.reasoningText
  const contentText =
    notification.streamKind === 'book' ? bookStream.rawText : installStream.rawText
  const heading =
    notification.streamKind === 'book'
      ? 'AI 最后输出'
      : notification.phase === 'failure'
        ? '上次 AI 输出'
        : 'AI 输出'
  const emptyLabel =
    notification.streamKind === 'book' ? '无 AI 输出记录' : '等待 AI 开始输出…'

  return (
    <>
      <p class="notification-center__stream-heading">{heading}</p>
      <AiStreamPreview
        reasoningText={reasoningText}
        contentText={contentText}
        variant="notification"
        emptyLabel={emptyLabel}
      />
    </>
  )
}

export function OsNotificationDetail({
  notification,
  onBack,
}: {
  notification: OsNotification
  onBack: () => void
}) {
  const running = notification.phase === 'running'
  const percent = Math.round(notification.progress?.percent ?? 0)

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
      <div class={detailCardClassName(notification)}>
        <div class="notification-center__detail-hero">
          <OsNotificationIconView notification={notification} size={52} />
          <div class="notification-center__detail-copy">
            <p class="notification-center__detail-title">{notification.title}</p>
            <p class={detailPhaseClassName(notification)}>{notification.subtitle}</p>
          </div>
        </div>
        {running && notification.progress && (
          <>
            <div class="notification-center__detail-stats">
              <div class="notification-center__stat">
                <span class="notification-center__stat-label">进度</span>
                <span class="notification-center__stat-value">{percent}%</span>
              </div>
              {notification.progress.statLabel && (
                <div class="notification-center__stat">
                  <span class="notification-center__stat-label">
                    {notification.progress.statLabel}
                  </span>
                  <span class="notification-center__stat-value">
                    {notification.progress.statValue ?? ''}
                  </span>
                </div>
              )}
            </div>
            <div class="notification-center__detail-progress" aria-hidden="true">
              <span class="notification-center__detail-progress-track">
                <span
                  class="notification-center__detail-progress-fill"
                  style={{ width: `${percent}%` }}
                />
              </span>
            </div>
          </>
        )}
        {notification.body && (
          <p class="notification-center__detail-error">{notification.body}</p>
        )}
        {notification.actions && notification.actions.length > 0 && (
          <div class="notification-center__detail-actions">
            {notification.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                class={
                  action.tone === 'primary'
                    ? 'notification-center__action notification-center__action--primary'
                    : 'notification-center__action'
                }
                onClick={() => invokeOsNotificationAction(notification.id, action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <OsNotificationStream notification={notification} />
    </div>
  )
}
