import { useMemo, useState } from 'preact/hooks'
import {
  clearBrowserHistory,
  getBrowserHistoryStorageBytes,
  loadBrowserHistory,
} from '../browser/browser-history.ts'
import { formatStorageSize } from './format-storage-size.ts'

type SafariHistoryViewProps = {
  onHistoryChange?: () => void
}

export function SafariHistoryView({ onHistoryChange }: SafariHistoryViewProps) {
  const [revision, setRevision] = useState(0)
  const visitCount = useMemo(() => loadBrowserHistory().length, [revision])
  const historyBytes = useMemo(() => getBrowserHistoryStorageBytes(), [revision])
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  const bump = () => {
    setRevision((value) => value + 1)
    onHistoryChange?.()
  }

  const handleClearAll = () => {
    clearBrowserHistory()
    setConfirmClearAll(false)
    bump()
  }

  return (
    <section class="settings__section">
      <h2 class="settings__section-title">浏览历史</h2>
      <div class="settings__box">
        <dl class="settings__form-row">
          <dt>历史记录</dt>
          <dd>{visitCount.toLocaleString('zh-CN')} 条</dd>
        </dl>
        <dl class="settings__form-row">
          <dt>占用空间</dt>
          <dd>{formatStorageSize(historyBytes)}</dd>
        </dl>
      </div>

      {visitCount > 0 && (
        <div class="settings__actions">
          <button
            type="button"
            class="settings__btn settings__btn--danger"
            onClick={() => setConfirmClearAll(true)}
          >
            清空浏览历史
          </button>
        </div>
      )}

      <p class="settings__section-footnote">
        浏览历史记录你访问过的网页地址与标题，用于地址栏联想与历史面板。清空后无法恢复。
      </p>

      {confirmClearAll && (
        <ConfirmSheet
          title="清空浏览历史？"
          message="所有 Safari 浏览历史将被删除，地址栏联想与历史面板将不再显示这些记录。"
          confirmLabel="清空"
          onCancel={() => setConfirmClearAll(false)}
          onConfirm={handleClearAll}
        />
      )}
    </section>
  )
}

type ConfirmSheetProps = {
  title: string
  message: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmSheet({ title, message, confirmLabel, onCancel, onConfirm }: ConfirmSheetProps) {
  return (
    <div class="settings__sheet-backdrop" role="presentation" onClick={onCancel}>
      <div
        class="settings__sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="safari-history-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="settings__sheet-body">
          <div class="settings__sheet-icon" aria-hidden="true">
            !
          </div>
          <div class="settings__sheet-copy">
            <h3 class="settings__sheet-title" id="safari-history-sheet-title">
              {title}
            </h3>
            <p class="settings__sheet-message">{message}</p>
          </div>
        </div>
        <div class="settings__sheet-actions">
          <button type="button" class="settings__btn settings__btn--plain" onClick={onCancel}>
            取消
          </button>
          <button type="button" class="settings__btn settings__btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
