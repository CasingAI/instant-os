/** 外部挂载卷因未授权被强制卸载时的系统通知。 */

export const MOUNT_DISCONNECTED_SLUG = 'system:mount-disconnected'

export const SHOW_MOUNT_DISCONNECTED_NOTIFICATION_EVENT =
  'instant-os:show-mount-disconnected-notification'

export type MountDisconnectedNotificationDetail = {
  label: string
}

export const MOUNT_DISCONNECTED_COPY = {
  bannerTitle: '外部文件夹已断开',
  listTitle: '外部文件夹已断开',
  dismissButton: '知道了',
} as const

export function messageForMountDisconnected(label: string): {
  title: string
  subtitle: string
} {
  return {
    title: MOUNT_DISCONNECTED_COPY.bannerTitle,
    subtitle: `「${label}」未获授权，已从容器列表移除`,
  }
}

export function detailBodyForMountDisconnected(label: string): string {
  return `未能获得对「${label}」的访问授权。系统已将该容器卸载，效果类似外部存储设备被直接拔出。如需继续使用，请重新挂载该文件夹。`
}

export function showMountDisconnectedNotification(label: string): void {
  window.dispatchEvent(
    new CustomEvent<MountDisconnectedNotificationDetail>(
      SHOW_MOUNT_DISCONNECTED_NOTIFICATION_EVENT,
      { detail: { label } },
    ),
  )
}
