type VersionRollbackModalProps = {
  currentVersion: string
  previousVersion: string
  onCancel: () => void
  onConfirm: () => void
}

export function VersionRollbackModal({
  currentVersion,
  previousVersion,
  onCancel,
  onConfirm,
}: VersionRollbackModalProps) {
  return (
    <div class="appstore-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        class="appstore-modal appstore-modal--alert"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="appstore-version-rollback-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="appstore-modal__header">
          <h2 class="appstore-modal__title" id="appstore-version-rollback-title">
            退回上一版本
          </h2>
        </header>

        <div class="appstore-modal__body">
          <p class="appstore-modal__message">
            将把当前版本 {currentVersion} 替换为 {previousVersion}，并删除 {currentVersion} 的所有代码。
          </p>
          <p class="appstore-modal__message appstore-modal__message--warn">
            此操作无法撤销，退回后将无法恢复到 {currentVersion}。如需再次获得该版本，只能重新点击「更新」让 AI 生成同版本号的新版。
          </p>
        </div>

        <footer class="appstore-modal__footer">
          <button type="button" class="appstore-modal__btn appstore-modal__btn--secondary" onClick={onCancel}>
            取消
          </button>
          <button type="button" class="appstore-modal__btn appstore-modal__btn--danger" onClick={onConfirm}>
            确认退回
          </button>
        </footer>
      </div>
    </div>
  )
}
