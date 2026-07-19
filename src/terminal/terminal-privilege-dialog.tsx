import { useEffect, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import { WindowModal } from '../window/window-modal.tsx'
import { pickDirectoryToMount } from '../apps/files/files-mount-store.ts'
import {
  getPendingTerminalPrivilegeConfirm,
  resolveTerminalPrivilegeConfirm,
  subscribeTerminalPrivilegeConfirm,
} from './terminal-privilege-confirm-store.ts'
import { describeTerminalPrivilege } from './terminal-privilege.ts'
import './terminal-privilege-dialog.css'

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function TerminalPrivilegeDialog() {
  const [request, setRequest] = useState(() => getPendingTerminalPrivilegeConfirm())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return subscribeTerminalPrivilegeConfirm(() => {
      setRequest(getPendingTerminalPrivilegeConfirm())
      setBusy(false)
    })
  }, [])

  const open = Boolean(request)
  const copy = request ? describeTerminalPrivilege(request) : undefined

  const handleCancel = () => {
    if (busy) return
    resolveTerminalPrivilegeConfirm({ confirmed: false })
  }

  const handleConfirm = () => {
    if (!request || busy) return

    if (request.kind === 'mount') {
      setBusy(true)
      void (async () => {
        try {
          const handle = await pickDirectoryToMount()
          resolveTerminalPrivilegeConfirm({ confirmed: true, mountHandle: handle })
        } catch (error) {
          if (isAbortError(error)) {
            resolveTerminalPrivilegeConfirm({ confirmed: false })
            return
          }
          setBusy(false)
          resolveTerminalPrivilegeConfirm({ confirmed: false })
        }
      })()
      return
    }

    resolveTerminalPrivilegeConfirm({ confirmed: true })
  }

  return createPortal(
    <div class="terminal-privilege-host" aria-hidden={!open}>
      <WindowModal
        open={open}
        role="alertdialog"
        title={copy?.title ?? '确认操作'}
        themeColor={copy?.danger ? '#c45a4a' : '#d4a017'}
        panelClass={`terminal-privilege-modal${copy?.danger ? ' terminal-privilege-modal--danger' : ' terminal-privilege-modal--caution'}`}
        onClose={handleCancel}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            tone: 'secondary',
            disabled: busy,
            onClick: handleCancel,
          },
          {
            key: 'confirm',
            label: busy ? '请选择…' : (copy?.confirmLabel ?? '确认'),
            tone: copy?.danger ? 'danger' : 'primary',
            disabled: busy,
            onClick: handleConfirm,
          },
        ]}
      >
        <div
          class={`terminal-privilege-modal__badge${copy?.danger ? ' terminal-privilege-modal__badge--danger' : ''}`}
          aria-hidden="true"
        >
          <span class="terminal-privilege-modal__badge-mark">!</span>
        </div>
        <p class="terminal-privilege-modal__intent">{copy?.intentLine}</p>
        {copy?.note ? <p class="terminal-privilege-modal__note">{copy.note}</p> : undefined}
        <p class="terminal-privilege-modal__hint">{copy?.warning}</p>
      </WindowModal>
    </div>,
    getFloatingOverlayRoot(),
  )
}
