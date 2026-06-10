import { useEffect, useMemo, useState } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
import {
  listOtherStorageEntries,
  STORAGE_CHANGED_EVENT,
  type OtherStorageEntry,
} from '../../os/device-storage.ts'
import { formatStorageSize } from './format-storage-size.ts'

type OtherStorageViewProps = {
  totalBytes: number
  onBack: () => void
}

function OtherStorageKeyRow({ entry }: { entry: OtherStorageEntry }) {
  const tooltip = entry.detail ?? entry.label
  const showKey = entry.detail !== undefined && entry.detail !== entry.label

  return (
    <div class="settings__row settings__row--static settings__row--key" title={tooltip}>
      <span class="settings__row-name">
        <span class={showKey ? undefined : 'settings__row-key'}>{entry.label}</span>
        {showKey ? <span class="settings__row-key-detail">{entry.detail}</span> : undefined}
      </span>
      <span class="settings__row-size">{formatStorageSize(entry.bytes)}</span>
    </div>
  )
}

export function OtherStorageView({ totalBytes, onBack }: OtherStorageViewProps) {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)
    window.addEventListener(STORAGE_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(STORAGE_CHANGED_EVENT, refresh)
  }, [])

  const entries = useMemo(() => listOtherStorageEntries(), [revision])

  return (
    <div class="settings settings--other-storage">
      <div class="settings__nav">
        <button type="button" class="settings__nav-back" onClick={onBack}>
          <span class="settings__nav-back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          存储空间
        </button>
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">其他</h2>
          <p class="settings__section-subtitle">
            未归入已知分类的 localStorage 键，共 {formatStorageSize(totalBytes)}
          </p>
          {entries.length === 0 ? (
            <div class="settings__box settings__empty">暂无未归类的 localStorage 键</div>
          ) : (
            <div class="settings__list">
              <div class="settings__list-head">
                <span>名称</span>
                <span>大小</span>
              </div>
              <div class="settings__list-body settings__list-body--keys">
                {entries.map((entry) => (
                  <OtherStorageKeyRow key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
