import { useState } from 'preact/hooks'

export const NEWS_REPORT_REASONS = [
  '垃圾广告或刷屏',
  '辱骂、人身攻击',
  '虚假或误导信息',
  '引战、钓鱼',
  '其他',
] as const

type NewsCommentReportSheetProps = {
  onCancel: () => void
  onSubmit: (reasons: string[]) => void
}

export function NewsCommentReportSheet({ onCancel, onSubmit }: NewsCommentReportSheetProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const toggleReason = (reason: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(reason)) {
        next.delete(reason)
      } else {
        next.add(reason)
      }
      return next
    })
  }

  const canSubmit = selected.size > 0

  return (
    <div class="news-report-sheet-backdrop" role="presentation" onClick={onCancel}>
      <div
        class="news-report-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="news-report-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 class="news-report-sheet__title" id="news-report-sheet-title">
          确认要举报吗？
        </h3>
        <p class="news-report-sheet__hint">请选择举报理由，提交后该评论将被删除。</p>

        <ul class="news-report-sheet__reasons">
          {NEWS_REPORT_REASONS.map((reason) => {
            const checked = selected.has(reason)
            return (
              <li key={reason}>
                <label class={`news-report-sheet__reason${checked ? ' news-report-sheet__reason--checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleReason(reason)}
                  />
                  <span>{reason}</span>
                </label>
              </li>
            )
          })}
        </ul>

        <div class="news-report-sheet__actions">
          <button type="button" class="news-report-sheet__btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            class="news-report-sheet__btn news-report-sheet__btn--danger"
            disabled={!canSubmit}
            onClick={() => onSubmit([...selected])}
          >
            提交举报
          </button>
        </div>
      </div>
    </div>
  )
}
