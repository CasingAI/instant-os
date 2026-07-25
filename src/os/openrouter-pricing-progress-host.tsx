import { FilesOpProgressDialog } from '../apps/files/files-op-progress-dialog.tsx'
import { useOpenRouterPricingNotification } from './use-openrouter-pricing-notification.ts'

/**
 * OpenRouter 绑定较多时（间隔 30 秒），用迷你进度窗补充通知中心。
 * 仅在进行中且总数 ≥ 2 时显示。
 */
export function OpenRouterPricingProgressHost() {
  const notification = useOpenRouterPricingNotification()
  if (!notification || notification.phase !== 'running' || notification.total < 2) {
    return null
  }
  const fraction =
    notification.total > 0 ? notification.current / notification.total : 0
  return (
    <FilesOpProgressDialog
      open
      title="正在更新 OpenRouter 定价"
      remainingLabel={`${notification.current}/${notification.total} · ${notification.message}`}
      fraction={fraction}
    />
  )
}
