import { useEffect, useRef, useState } from 'preact/hooks'
import { WindowModal } from '../../window/window-modal.tsx'

type KeychainTextFieldDialogProps = {
  open: boolean
  title: string
  label: string
  value: string
  type?: 'text' | 'password' | 'url'
  placeholder?: string
  message?: string
  allowEmpty?: boolean
  /** 为 false 时允许在未修改预填值时提交（如「下一步」） */
  requireDirty?: boolean
  saveLabel?: string
  onClose: () => void
  onSave: (value: string) => void | Promise<void>
}

export function KeychainTextFieldDialog({
  open,
  title,
  label,
  value,
  type = 'text',
  placeholder,
  message,
  allowEmpty = true,
  requireDirty = true,
  saveLabel = '保存',
  onClose,
  onSave,
}: KeychainTextFieldDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const inputId = `keychain-field-${title}`

  useEffect(() => {
    if (!open) return
    setDraft(value)
    setBusy(false)
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const trimmed = draft.trim()
  const dirty = draft !== value
  const canSave =
    (allowEmpty || trimmed.length > 0) && (!requireDirty || dirty) && !busy

  const handleClose = () => {
    if (busy) return
    onClose()
  }

  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      await onSave(type === 'password' ? draft : trimmed)
      onClose()
    } catch {
      // 保留对话框，由调用方处理错误提示
    } finally {
      setBusy(false)
    }
  }

  return (
    <WindowModal
      open={open}
      title={title}
      onClose={handleClose}
      actions={[
        {
          key: 'cancel',
          label: '取消',
          tone: 'secondary',
          disabled: busy,
          onClick: handleClose,
        },
        {
          key: 'save',
          label: saveLabel,
          tone: 'primary',
          disabled: !canSave,
          busy,
          onClick: () => void handleSave(),
        },
      ]}
    >
      {message && <p class="window-modal__message">{message}</p>}
      <div class="window-modal__field">
        <label for={inputId}>{label}</label>
        <input
          ref={inputRef}
          id={inputId}
          type={type}
          value={draft}
          placeholder={placeholder}
          autoComplete="off"
          spellcheck={false}
          disabled={busy}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave) {
              void handleSave()
            }
          }}
        />
      </div>
    </WindowModal>
  )
}
