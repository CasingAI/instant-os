import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  cacheModelUrl,
  clearModelCache,
  getModelCacheBytes,
  isModelCached,
  MODEL_CACHE_ENTRIES,
  type ModelCacheEntry,
} from '../../os/model-cache.ts'
import { formatStorageSize } from './format-storage-size.ts'

type ModelCacheViewProps = {
  onBack: () => void
}

type ModelRowState = {
  cached: boolean
  bytes: number
  busy: boolean
  error: string | null
}

const EMPTY_ROW: ModelRowState = {
  cached: false,
  bytes: 0,
  busy: false,
  error: null,
}

export function ModelCacheView({ onBack }: ModelCacheViewProps) {
  const [states, setStates] = useState<Record<string, ModelRowState>>({})
  const [pendingClear, setPendingClear] = useState<ModelCacheEntry | undefined>(undefined)

  const patchRow = useCallback((url: string, next: Partial<ModelRowState>) => {
    setStates((prev) => ({
      ...prev,
      [url]: { ...(prev[url] ?? EMPTY_ROW), ...next },
    }))
  }, [])

  const refreshRow = useCallback(
    async (url: string) => {
      const [cached, bytes] = await Promise.all([isModelCached(url), getModelCacheBytes(url)])
      patchRow(url, { cached, bytes })
    },
    [patchRow],
  )

  useEffect(() => {
    for (const entry of MODEL_CACHE_ENTRIES) {
      void refreshRow(entry.url)
    }
  }, [refreshRow])

  const cachedCount = useMemo(
    () => MODEL_CACHE_ENTRIES.filter((entry) => states[entry.url]?.cached).length,
    [states],
  )
  const occupiedBytes = useMemo(
    () =>
      MODEL_CACHE_ENTRIES.reduce((total, entry) => total + (states[entry.url]?.bytes ?? 0), 0),
    [states],
  )

  const handleCache = async (entry: ModelCacheEntry) => {
    if (states[entry.url]?.busy) return
    patchRow(entry.url, { busy: true, error: null })
    try {
      await cacheModelUrl(entry.url)
      await refreshRow(entry.url)
    } catch (cause) {
      patchRow(entry.url, {
        error: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      patchRow(entry.url, { busy: false })
    }
  }

  const handleClear = async (entry: ModelCacheEntry) => {
    if (states[entry.url]?.busy) return
    patchRow(entry.url, { busy: true, error: null })
    try {
      await clearModelCache(entry.url)
      await refreshRow(entry.url)
      setPendingClear(undefined)
    } catch (cause) {
      patchRow(entry.url, {
        error: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      patchRow(entry.url, { busy: false })
    }
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">模型缓存</h2>
          <p class="settings__section-subtitle">
            供分轨、歌词对齐等功能预先下载模型权重。已缓存 {cachedCount} /{' '}
            {MODEL_CACHE_ENTRIES.length} · 占用 {formatStorageSize(occupiedBytes)}
          </p>
          <div class="settings__list">
            {MODEL_CACHE_ENTRIES.map((entry) => {
              const row = states[entry.url] ?? EMPTY_ROW
              const meta = row.error
                ? row.error
                : row.cached
                  ? `${formatStorageSize(entry.totalBytes)} · 已缓存（${formatStorageSize(row.bytes)}）`
                  : `${formatStorageSize(entry.totalBytes)} · 未缓存`
              return (
                <div key={entry.url} class="settings__row settings__row--model-cache">
                  <span class="settings__row-name">
                    <span>{entry.label}</span>
                    <span
                      class={`settings__row-badge${row.cached ? ' settings__row-badge--ok' : ' settings__row-badge--warn'}`}
                    >
                      {row.cached ? '已缓存' : '未缓存'}
                    </span>
                  </span>
                  {row.cached ? (
                    <IosButton
                      size="compact"
                      tone="danger"
                      disabled={row.busy}
                      onClick={() => setPendingClear(entry)}
                    >
                      {row.busy ? '清除中…' : '清除'}
                    </IosButton>
                  ) : (
                    <IosButton
                      size="compact"
                      disabled={row.busy}
                      onClick={() => void handleCache(entry)}
                    >
                      {row.busy ? '缓存中…' : '缓存'}
                    </IosButton>
                  )}
                  <p
                    class={`settings__row-model-cache-meta${row.error ? ' settings__row-model-cache-meta--error' : ''}`}
                  >
                    {meta}
                  </p>
                </div>
              )
            })}
          </div>
          <p class="settings__section-footnote">
            模型权重缓存在浏览器 Cache API 中，与系统存储空间（虚拟文件系统 /
            IndexedDB）完全独立，不计入「存储空间」统计。缓存后按同一 URL
            请求可瞬间完成，无需重复下载。
          </p>
        </section>
      </div>

      {pendingClear && (
        <ConfirmSheet
          title={`清除 ${pendingClear.label} 的缓存？`}
          message={`${formatStorageSize(pendingClear.totalBytes)} 的权重将从浏览器缓存中删除，下次使用需重新下载。`}
          confirmLabel={states[pendingClear.url]?.busy ? '清除中…' : '清除'}
          confirmDisabled={Boolean(states[pendingClear.url]?.busy)}
          onCancel={() => {
            if (states[pendingClear.url]?.busy) return
            setPendingClear(undefined)
          }}
          onConfirm={() => void handleClear(pendingClear)}
        />
      )}
    </div>
  )
}

type ConfirmSheetProps = {
  title: string
  message: string
  confirmLabel: string
  confirmDisabled: boolean
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmSheet({
  title,
  message,
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
}: ConfirmSheetProps) {
  return (
    <div class="settings__sheet-backdrop" role="presentation" onClick={onCancel}>
      <div
        class="settings__sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="model-cache-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="settings__sheet-body">
          <div class="settings__sheet-icon" aria-hidden="true">
            !
          </div>
          <div class="settings__sheet-copy">
            <h3 class="settings__sheet-title" id="model-cache-sheet-title">
              {title}
            </h3>
            <p class="settings__sheet-message">{message}</p>
          </div>
        </div>
        <div class="settings__sheet-actions">
          <IosButton disabled={confirmDisabled} onClick={onCancel}>
            取消
          </IosButton>
          <IosButton tone="danger" disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </IosButton>
        </div>
      </div>
    </div>
  )
}
