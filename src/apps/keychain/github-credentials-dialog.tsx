import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  clearGithubCredentials,
  loadGithubCredentials,
  saveGithubCredentials,
} from '../../os/github-credentials-storage.ts'
import { WindowModal } from '../../window/window-modal.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'

type GithubCredentialsDialogProps = {
  open: boolean
  onClose: () => void
  onChanged?: () => void
}

export function GithubCredentialsDialog({
  open,
  onClose,
  onChanged,
}: GithubCredentialsDialogProps) {
  const modal = useWindowModal()
  const inputRef = useRef<HTMLInputElement>(null)
  const [savedToken, setSavedToken] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    if (!open) return
    const current = loadGithubCredentials().token
    setSavedToken(current)
    setToken(current)
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const dirty = useMemo(() => token !== savedToken, [savedToken, token])
  const canSave = dirty

  const handleSave = () => {
    const trimmed = token.trim()
    if (!saveGithubCredentials({ version: 1, token: trimmed })) return
    setSavedToken(trimmed)
    setToken(trimmed)
    onChanged?.()
    onClose()
  }

  const handleClear = async () => {
    if (!savedToken) {
      setToken('')
      return
    }

    const confirmed = await modal.confirm({
      title: '移除 GitHub 密钥',
      message: '确定要移除已保存的 GitHub Personal Access Token 吗？',
      confirmLabel: '移除',
      confirmTone: 'danger',
    })
    if (!confirmed) return

    if (!clearGithubCredentials()) return
    setSavedToken('')
    setToken('')
    onChanged?.()
    onClose()
  }

  const actions = [
    {
      key: 'cancel',
      label: '取消',
      tone: 'secondary' as const,
      onClick: onClose,
    },
    ...(savedToken
      ? [
          {
            key: 'clear',
            label: '移除',
            tone: 'danger' as const,
            onClick: () => {
              void handleClear()
              return false
            },
          },
        ]
      : []),
    {
      key: 'save',
      label: '保存',
      tone: 'primary' as const,
      disabled: !canSave,
      onClick: handleSave,
    },
  ]

  return (
    <WindowModal
      open={open}
      title="GitHub Token"
      onClose={onClose}
      actions={actions}
    >
      <p class="window-modal__message">
        填写 Personal Access Token，用于访问 GitHub API。仅保存在本机。若希望 GitHub Desktop
        自动填入真实提交邮箱，classic Token 请勾选 user:email；细粒度 Token 请授予 Email
        addresses 只读。
      </p>
      <div class="window-modal__field">
        <label for="keychain-github-token-input">Token</label>
        <input
          ref={inputRef}
          id="keychain-github-token-input"
          type="password"
          value={token}
          placeholder="ghp_..."
          autoComplete="off"
          spellcheck={false}
          onInput={(e) => setToken((e.currentTarget as HTMLInputElement).value)}
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
