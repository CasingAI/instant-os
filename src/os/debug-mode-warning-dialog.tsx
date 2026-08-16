import { useEffect, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import { WindowModal } from '../window/window-modal.tsx'
import {
  getPendingDebugModeConfirm,
  resolveDebugModeConfirm,
  subscribeDebugModeConfirm,
  type DebugModeConfirmRequest,
} from './debug-mode-confirm-store.ts'
import './debug-mode-warning-dialog.css'

export function DebugModeWarningDialog() {
  const [request, setRequest] = useState<DebugModeConfirmRequest | undefined>(() =>
    getPendingDebugModeConfirm(),
  )

  useEffect(() => {
    return subscribeDebugModeConfirm(() => {
      setRequest(getPendingDebugModeConfirm())
    })
  }, [])

  const open = Boolean(request)
  const command = request?.command

  const handleCancel = () => {
    resolveDebugModeConfirm(false)
  }

  const handleConfirm = () => {
    resolveDebugModeConfirm(true)
  }

  return createPortal(
    <div class="debug-mode-warning-host" aria-hidden={!open}>
      <WindowModal
        open={open}
        role="alertdialog"
        title="Debug 模式启动"
        themeColor="#c45a4a"
        panelClass="debug-mode-warning-modal"
        onClose={handleCancel}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            tone: 'secondary',
            onClick: handleCancel,
          },
          {
            key: 'confirm',
            label: '确认进入',
            tone: 'danger',
            onClick: handleConfirm,
          },
        ]}
      >
        <div class="debug-mode-warning-modal__badge" aria-hidden="true">
          <span class="debug-mode-warning-modal__badge-mark">!</span>
        </div>
        <p class="debug-mode-warning-modal__intent">
          当前处于调试模式，系统处于非受控状态，仅用于开发测试。
        </p>
        {command ? (
          <>
            <p class="debug-mode-warning-modal__note">
              进入桌面后将在系统终端中执行以下启动命令：
            </p>
            <pre class="debug-mode-warning-modal__command">
              <code>{command}</code>
            </pre>
            <p class="debug-mode-warning-modal__hint">
              命令以调试者提供的代码直接执行，请确认来源可信后再进入。
            </p>
          </>
        ) : (
          <p class="debug-mode-warning-modal__hint">
            本次启动将使用调试预设配置，请确认后进入。
          </p>
        )}
      </WindowModal>
    </div>,
    getFloatingOverlayRoot(),
  )
}
