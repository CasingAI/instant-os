type AppIconNotificationBadgeProps = {
  count: number
}

export function AppIconNotificationBadge({ count }: AppIconNotificationBadgeProps) {
  if (count <= 0) {
    return undefined
  }

  const label = count > 9 ? '9+' : String(count)

  return (
    <span class="app-icon-notification-badge" aria-label={`${count} 个待更新`}>
      {label}
    </span>
  )
}
