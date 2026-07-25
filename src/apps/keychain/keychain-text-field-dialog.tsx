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
  onSave: (value: string) => void
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
  const inputId = `keychain-field-${title}`

  useEffect(() => {
    if (!open) return
    setDraft(value)
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const trimmed = draft.trim()
  const dirty = draft !== value
  const canSave =
    (allowEmpty || trimmed.length > 0) && (!requireDirty || dirty)

  const handleSave = () => {
    if (!canSave) return
    onSave(type === 'password' ? draft : trimmed)
    onClose()
  }

  return (
    <WindowModal
      open={open}
      title={title}
      onClose={onClose}
      actions={[
        {
          key: 'cancel',
          label: '取消',
          tone: 'secondary',
          onClick: onClose,
        },
        {
          key: 'save',
          label: saveLabel,
          tone: 'primary',
          disabled: !canSave,
          onClick: handleSave,
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
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave) {
              handleSave()
            }
          }}
        />
      </div>
    </WindowModal>
  )
}
