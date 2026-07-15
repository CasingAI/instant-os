import { createPortal } from 'preact/compat'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import './app-uninstall-confirm-sheet.css'

type AppUninstallConfirmSheetProps = {
  appName: string
  onCancel: () => void
  onConfirm: () => void
}

export function AppUninstallConfirmSheet({
  appName,
  onCancel,
  onConfirm,
}: AppUninstallConfirmSheetProps) {
  return createPortal(
    <div class="os-uninstall-confirm-backdrop" role="presentation" onClick={onCancel}>
      <div
        class="os-uninstall-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="os-uninstall-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="os-uninstall-confirm__body">
          <div class="os-uninstall-confirm__icon" aria-hidden="true">
            !
          </div>
          <div class="os-uninstall-confirm__copy">
            <h3 class="os-uninstall-confirm__title" id="os-uninstall-confirm-title">
              确定要卸载「{appName}」吗？
            </h3>
            <p class="os-uninstall-confirm__message">
              应用及其所有数据将被永久删除，此操作不可恢复。
            </p>
          </div>
        </div>
        <div class="os-uninstall-confirm__actions">
          <button type="button" class="os-uninstall-confirm__btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            class="os-uninstall-confirm__btn os-uninstall-confirm__btn--danger"
            onClick={onConfirm}
          >
            卸载
          </button>
        </div>
      </div>
    </div>,
    getFloatingOverlayRoot(),
  )
}
