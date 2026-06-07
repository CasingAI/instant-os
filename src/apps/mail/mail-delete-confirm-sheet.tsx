export type MailDeleteConfirmTarget =
  | { kind: 'thread'; threadId: string; subject: string }
  | { kind: 'message'; threadId: string; messageId: string }

type MailDeleteConfirmSheetProps = {
  target: MailDeleteConfirmTarget
  onCancel: () => void
  onConfirm: () => void
}

function confirmCopy(target: MailDeleteConfirmTarget): { title: string; message: string } {
  if (target.kind === 'thread') {
    return {
      title: '删除对话？',
      message: `「${target.subject}」中的全部邮件将被永久删除，此操作不可恢复。`,
    }
  }

  return {
    title: '删除此消息？',
    message: '该消息将被永久删除。若对话中没有其他消息，整个对话也会被删除。',
  }
}

export function MailDeleteConfirmSheet({ target, onCancel, onConfirm }: MailDeleteConfirmSheetProps) {
  const { title, message } = confirmCopy(target)

  return (
    <div class="mail__confirm-backdrop" role="presentation" onClick={onCancel}>
      <div
        class="mail__confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mail-delete-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="mail__confirm-body">
          <div class="mail__confirm-icon" aria-hidden="true">
            !
          </div>
          <div class="mail__confirm-copy">
            <h3 class="mail__confirm-title" id="mail-delete-confirm-title">
              {title}
            </h3>
            <p class="mail__confirm-message">{message}</p>
          </div>
        </div>
        <div class="mail__confirm-actions">
          <button type="button" class="mail__btn mail__btn--secondary" onClick={onCancel}>
            取消
          </button>
          <button type="button" class="mail__btn mail__btn--danger" onClick={onConfirm}>
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
