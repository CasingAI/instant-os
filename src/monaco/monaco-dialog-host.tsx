import { useEffect, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import { WindowModal } from '../window/window-modal.tsx'
import {
  getPendingMonacoDialog,
  resolveMonacoDialog,
  subscribeMonacoDialog,
  type MonacoDialogRequest,
} from './monaco-dialog-store.ts'
import './monaco-dialog-host.css'

function detailLines(detail: string | undefined): string[] {
  if (!detail?.trim()) return []
  return detail.split('\n').filter((line) => line.length > 0)
}

export function MonacoDialogHost() {
  const [request, setRequest] = useState<MonacoDialogRequest | undefined>(() =>
    getPendingMonacoDialog(),
  )

  useEffect(() => {
    return subscribeMonacoDialog(() => {
      setRequest(getPendingMonacoDialog())
    })
  }, [])

  const open = Boolean(request)

  const handleDismiss = () => {
    if (!request) return
    resolveMonacoDialog(request.dismissKey ?? request.buttons[0]?.key ?? 'cancel')
  }

  return createPortal(
    <div class="monaco-dialog-host" aria-hidden={!open}>
      <WindowModal
        open={open}
        role="alertdialog"
        title={request?.title ?? '确认'}
        onClose={handleDismiss}
        actions={(request?.buttons ?? []).map((button) => ({
          key: button.key,
          label: button.label,
          tone: button.tone ?? 'secondary',
          onClick: () => {
            resolveMonacoDialog(button.key)
          },
        }))}
      >
        {request ? (
          <>
            <p class="window-modal__message">{request.message}</p>
            {detailLines(request.detail).map((line, index) => (
              <p key={index} class="window-modal__message">
                {line}
              </p>
            ))}
          </>
        ) : undefined}
      </WindowModal>
    </div>,
    getFloatingOverlayRoot(),
  )
}
