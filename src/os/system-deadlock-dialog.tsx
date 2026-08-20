import { useEffect, useState } from 'preact/hooks'
import { WindowModal } from '../window/window-modal.tsx'
import { copyRecentSystemDebugLogs } from '../apps/event-log/system-debug-log-panel.tsx'
import { useGeneratedAppHeartbeat } from './generated-app-heartbeat-context.tsx'
import { useOs } from './os-context.tsx'
import './system-deadlock-dialog.css'

export const SYSTEM_DEADLOCK_DIALOG_COPY = {
  title: '一个或多个应用程序长时间未响应',
  message:
    '有应用长时间未响应，如果问题持续，可以关闭未响应的程序。',
  continueWaiting: '稍后自行决定',
  taskManager: '性能监视器',
  closeApps: '关闭程序',
} as const

export function SystemDeadlockDialog() {
  const { openApp, closeProcessIsolatedApps } = useOs()
  const { isAnyWindowDeadlocked } = useGeneratedAppHeartbeat()
  const deadlocked = isAnyWindowDeadlocked()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!deadlocked) {
      setDismissed(false)
    }
  }, [deadlocked])

  const open = deadlocked && !dismissed

  return (
    <WindowModal
      open={open}
      role="alertdialog"
      title={SYSTEM_DEADLOCK_DIALOG_COPY.title}
      panelClass="system-deadlock-dialog"
      actions={[
        {
          key: 'continue',
          label: SYSTEM_DEADLOCK_DIALOG_COPY.continueWaiting,
          tone: 'secondary',
          onClick: () => {
            setDismissed(true)
          },
        },
        {
          key: 'task-manager',
          label: SYSTEM_DEADLOCK_DIALOG_COPY.taskManager,
          tone: 'secondary',
          onClick: () => {
            openApp('task-manager')
            setDismissed(true)
          },
        },
        {
          key: 'close-apps',
          label: SYSTEM_DEADLOCK_DIALOG_COPY.closeApps,
          tone: 'primary',
          onClick: () => {
            closeProcessIsolatedApps()
            setDismissed(true)
          },
        },
      ]}
    >
      <p class="window-modal__message">{SYSTEM_DEADLOCK_DIALOG_COPY.message}</p>
      <p class="system-deadlock-dialog__diag-hint">
        若怀疑整页卡死，请新开标签页打开「事件日志 → 系统」查看上次会话残留；也可先复制最近 30 条诊断面包屑。
      </p>
      <button
        type="button"
        class="system-deadlock-dialog__copy-diag"
        onClick={() => {
          void navigator.clipboard.writeText(copyRecentSystemDebugLogs(30))
        }}
      >
        复制最近诊断（30 条）
      </button>
    </WindowModal>
  )
}
