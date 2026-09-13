import { WindowModal } from '../window/window-modal.tsx'
import { useOs } from './os-context.tsx'

export const UNRESPONSIVE_CLOSE_DIALOG_COPY = {
  title: '未响应',
  message: '没有在时限内回应关闭。要立刻结束吗？',
  wait: '继续等待',
  force: '立刻结束',
} as const

/**
 * 关闭处理超时的系统「未响应」弹窗：程序没在约 5 秒内回答能否结束，
 * 由用户决定继续等（再续 5 秒，可循环）还是立刻强制结束（跳过程序直接关窗）。
 */
export function UnresponsiveCloseDialog() {
  const { unresponsiveClose, resolveUnresponsiveClose } = useOs()

  return (
    <WindowModal
      open={unresponsiveClose !== undefined}
      role="alertdialog"
      title={UNRESPONSIVE_CLOSE_DIALOG_COPY.title}
      actionsLayout="row"
      actions={[
        {
          key: 'wait',
          label: UNRESPONSIVE_CLOSE_DIALOG_COPY.wait,
          tone: 'secondary',
          onClick: () => resolveUnresponsiveClose('wait'),
        },
        {
          key: 'force',
          label: UNRESPONSIVE_CLOSE_DIALOG_COPY.force,
          tone: 'danger',
          onClick: () => resolveUnresponsiveClose('force'),
        },
      ]}
    >
      <p class="window-modal__message">{UNRESPONSIVE_CLOSE_DIALOG_COPY.message}</p>
    </WindowModal>
  )
}
