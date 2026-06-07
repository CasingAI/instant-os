import { useState } from 'preact/hooks'

type ReviewComposeModalProps = {
  appVersion: string | undefined
  onClose: () => void
  onSubmit: (body: string, rating: number) => boolean
}

export function ReviewComposeModal({ appVersion, onClose, onSubmit }: ReviewComposeModalProps) {
  const [draft, setDraft] = useState('')
  const [rating, setRating] = useState(5)
  const [submitError, setSubmitError] = useState<string | undefined>(undefined)

  const handleSubmit = () => {
    const ok = onSubmit(draft, rating)
    if (!ok) {
      setSubmitError('请输入评论内容')
      return
    }
    onClose()
  }

  return (
    <div class="appstore-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        class="appstore-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appstore-review-compose-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="appstore-modal__header">
          <h2 class="appstore-modal__title" id="appstore-review-compose-title">
            写评论
          </h2>
          <button type="button" class="appstore-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div class="appstore-modal__body">
          {appVersion && (
            <p class="appstore-modal__eyebrow">针对 {appVersion}</p>
          )}
          <p class="appstore-modal__label">评分</p>
          <div class="appstore-modal__stars" role="group" aria-label="评分">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                class={`appstore-modal__star${value <= rating ? ' appstore-modal__star--active' : ''}`}
                onClick={() => setRating(value)}
                aria-label={`${value} 星`}
              >
                ★
              </button>
            ))}
          </div>
          <label class="appstore-modal__label" for="appstore-review-compose-body">
            评论
          </label>
          <textarea
            id="appstore-review-compose-body"
            class="appstore-modal__textarea"
            rows={4}
            placeholder="描述你的使用体验或改进建议…"
            value={draft}
            autoFocus
            onInput={(event) => setDraft((event.currentTarget as HTMLTextAreaElement).value)}
          />
          {submitError && <p class="appstore-modal__error">{submitError}</p>}
          <p class="appstore-modal__hint">发布后，顶部按钮将变为「更新」，AI 会根据你的反馈生成新版本</p>
        </div>

        <footer class="appstore-modal__footer">
          <button type="button" class="appstore-modal__btn appstore-modal__btn--secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" class="appstore-modal__btn appstore-modal__btn--primary" onClick={handleSubmit}>
            发布
          </button>
        </footer>
      </div>
    </div>
  )
}
