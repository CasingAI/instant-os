/** 系统通知用 emoji（性能加速）。 */
export const PROCESS_ISOLATION_FALLBACK_EMOJI = '⚡'

export const PROCESS_ISOLATION_FALLBACK_SLUG = '__process-isolation-fallback__'

export const SHOW_PROCESS_ISOLATION_FALLBACK_NOTIFICATION_EVENT =
  'instant-os:show-process-isolation-fallback-notification'

/** 进程隔离回退相关文案（横幅、通知中心列表与详情）。 */
export const PROCESS_ISOLATION_FALLBACK_COPY = {
  bannerTitle: '性能加速已关闭',
  bannerSubtitle: '当前的部署环境无法支持性能加速',
  listTitle: '性能加速已关闭',
  listSubtitle: '当前的部署环境无法支持性能加速',
  detailTitle: '性能加速已关闭',
  detailBody:
    '窗口合成器加速功能已关闭，因为你的当前浏览器环境无法支持。',
  disableButton: '关闭该特性',
  dismissButton: '忽略',
} as const

export function messageForProcessIsolationFallback(): {
  title: string
  subtitle: string
} {
  return {
    title: PROCESS_ISOLATION_FALLBACK_COPY.bannerTitle,
    subtitle: PROCESS_ISOLATION_FALLBACK_COPY.bannerSubtitle,
  }
}

export function showProcessIsolationFallbackNotification(): void {
  window.dispatchEvent(new CustomEvent(SHOW_PROCESS_ISOLATION_FALLBACK_NOTIFICATION_EVENT))
}
