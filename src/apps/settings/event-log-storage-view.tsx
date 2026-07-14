import { useEffect, useState } from 'preact/hooks'
import {
  AI_EVENT_LOG_CHANGED_EVENT,
  clearAiEventLog,
} from '../../ai/ai-event-log.ts'
import { getAiEventLogBytes } from '../../ai/ai-event-log-storage.ts'
import { DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { formatStorageSize } from './format-storage-size.ts'

type EventLogStorageViewProps = {
  onBack: () => void
}

export function EventLogStorageView({ onBack }: EventLogStorageViewProps) {
  const [bytes, setBytes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    const refresh = () => {
      void getAiEventLogBytes().then((next) => {
        setBytes(next)
        setLoading(false)
      })
    }
    refresh()
    window.addEventListener(DATA_STORAGE_CHANGED_EVENT, refresh)
    window.addEventListener(AI_EVENT_LOG_CHANGED_EVENT, refresh)
    return () => {
      window.removeEventListener(DATA_STORAGE_CHANGED_EVENT, refresh)
      window.removeEventListener(AI_EVENT_LOG_CHANGED_EVENT, refresh)
    }
  }, [])

  const handleClear = () => {
    if (clearing) {
      return
    }
    setClearing(true)
    void clearAiEventLog()
      .then(() => {
        setBytes(0)
        setConfirmClear(false)
      })
      .finally(() => {
        setClearing(false)
      })
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="存储空间" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">事件日志</h2>
          <p class="settings__section-subtitle">
            各应用调用 AI 时保存的完整输入与输出，占用数据空间（IndexedDB）
          </p>
          <div class="settings__box">
            <dl class="settings__form-row">
              <dt>占用空间</dt>
              <dd>{loading ? '计算中…' : formatStorageSize(bytes)}</dd>
            </dl>
          </div>

          {bytes > 0 && (
            <div class="settings__actions settings__actions--inline">
              <button
                type="button"
                class="settings__btn settings__btn--danger"
                disabled={clearing}
                onClick={() => setConfirmClear(true)}
              >
                {clearing ? '清空中…' : '清空全部事件日志'}
              </button>
            </div>
          )}

          <p class="settings__section-footnote">
            清空后不可恢复。也可在「事件日志」应用中单条删除记录。
          </p>
        </section>
      </div>

      {confirmClear && (
        <div
          class="settings__sheet-backdrop"
          role="presentation"
          onClick={() => !clearing && setConfirmClear(false)}
        >
          <div
            class="settings__sheet"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="event-log-storage-sheet-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="settings__sheet-body">
              <div class="settings__sheet-icon" aria-hidden="true">
                !
              </div>
              <div class="settings__sheet-copy">
                <h3 class="settings__sheet-title" id="event-log-storage-sheet-title">
                  清空全部事件日志？
                </h3>
                <p class="settings__sheet-message">
                  所有 AI 调用的输入与输出记录将被删除，此操作不可撤销。
                </p>
              </div>
            </div>
            <div class="settings__sheet-actions">
              <button
                type="button"
                class="settings__btn settings__btn--plain"
                disabled={clearing}
                onClick={() => setConfirmClear(false)}
              >
                取消
              </button>
              <button
                type="button"
                class="settings__btn settings__btn--danger"
                disabled={clearing}
                onClick={handleClear}
              >
                {clearing ? '清空中…' : '清空'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
