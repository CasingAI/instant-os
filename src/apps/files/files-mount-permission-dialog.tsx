import { useEffect, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { getFloatingOverlayRoot } from '../../ui/floating-overlay-root.ts'
import { WindowModal } from '../../window/window-modal.tsx'
import {
  denyPendingMountPermission,
  getPendingMountPermission,
  grantPendingMountPermission,
  subscribeMountPermissionGate,
} from './files-mount-permission-gate.ts'
import '../../terminal/terminal-privilege-dialog.css'
import './files-mount-permission-dialog.css'

export function FilesMountPermissionDialog() {
  const [pending, setPending] = useState(() => getPendingMountPermission())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return subscribeMountPermissionGate(() => {
      setPending(getPendingMountPermission())
      setBusy(false)
    })
  }, [])

  const open = Boolean(pending)

  const handleDeny = () => {
    if (busy) return
    setBusy(true)
    void denyPendingMountPermission().finally(() => {
      setBusy(false)
    })
  }

  const handleGrant = () => {
    if (!pending || busy) return
    setBusy(true)
    void grantPendingMountPermission().finally(() => {
      setBusy(false)
    })
  }

  return createPortal(
    <div class="files-mount-permission-host" aria-hidden={!open}>
      <WindowModal
        open={open}
        role="alertdialog"
        title="需要授权"
        themeColor="#d4a017"
        panelClass="terminal-privilege-modal terminal-privilege-modal--caution files-mount-permission-modal"
        onClose={handleDeny}
        actions={[
          {
            key: 'deny',
            label: '不允许',
            tone: 'secondary',
            disabled: busy,
            onClick: handleDeny,
          },
          {
            key: 'grant',
            label: busy ? '等待浏览器…' : '授权',
            tone: 'primary',
            disabled: busy,
            onClick: handleGrant,
          },
        ]}
      >
        <div class="terminal-privilege-modal__badge" aria-hidden="true">
          <span class="terminal-privilege-modal__badge-mark">!</span>
        </div>
        <p class="terminal-privilege-modal__intent">
          需要授权才能访问外部文件夹
          {pending ? `「${pending.label}」` : ''}。
        </p>
        <p class="terminal-privilege-modal__note">
          浏览器将弹出确认框。若不允许，系统会卸载该容器，如同外部设备被直接拔出。
        </p>
        <p class="terminal-privilege-modal__hint">请先在本提示中选择「授权」，再完成浏览器确认。</p>
      </WindowModal>
    </div>,
    getFloatingOverlayRoot(),
  )
}
