import { useState } from 'preact/hooks'
import { parseMailAddressInput } from './parse-mail-address.ts'

type MailComposeSheetProps = {
  userEmail: string
  onClose: () => void
  onSend: (payload: { to: string; subject: string; body: string }) => void
  sending: boolean
}

export function MailComposeSheet({ userEmail, onClose, onSend, sending }: MailComposeSheetProps) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | undefined>()

  const handleSend = () => {
    const recipient = parseMailAddressInput(to)
    if (!recipient) {
      setError('请输入有效的收件人邮箱')
      return
    }
    if (!subject.trim()) {
      setError('请输入主题')
      return
    }
    if (!body.trim()) {
      setError('请输入邮件正文')
      return
    }
    setError(undefined)
    onSend({ to, subject: subject.trim(), body: body.trim() })
  }

  return (
    <div class="mail__compose-backdrop" role="presentation" onClick={onClose}>
      <div
        class="mail__compose"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mail-compose-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="mail__compose-header">
          <h2 class="mail__compose-title" id="mail-compose-title">
            新建邮件
          </h2>
          <button
            type="button"
            class="mail__compose-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div class="mail__compose-fields">
          <div class="mail__compose-row">
            <label for="mail-compose-from">发件人</label>
            <input id="mail-compose-from" type="text" value={userEmail} readOnly />
          </div>
          <div class="mail__compose-row">
            <label for="mail-compose-to">收件人</label>
            <input
              id="mail-compose-to"
              type="text"
              placeholder="姓名 <email@example.com>"
              value={to}
              onInput={(event) => setTo((event.target as HTMLInputElement).value)}
              autoFocus
            />
          </div>
          <div class="mail__compose-row">
            <label for="mail-compose-subject">主题</label>
            <input
              id="mail-compose-subject"
              type="text"
              value={subject}
              onInput={(event) => setSubject((event.target as HTMLInputElement).value)}
            />
          </div>
          <div class="mail__compose-row mail__compose-body">
            <label for="mail-compose-body">正文</label>
            <textarea
              id="mail-compose-body"
              value={body}
              onInput={(event) => setBody((event.target as HTMLTextAreaElement).value)}
            />
          </div>
          {error && (
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#c0392b' }}>{error}</p>
          )}
        </div>

        <footer class="mail__compose-footer">
          <button type="button" class="mail__btn mail__btn--secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            class="mail__btn mail__btn--primary"
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? '发送中…' : '发送'}
          </button>
        </footer>
      </div>
    </div>
  )
}
