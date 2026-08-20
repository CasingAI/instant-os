import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { filesReadBlob, filesStat } from '../files/files-api.ts'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import {
  assertImportedModelSize,
  cacheModelUrl,
  clearModelCache,
  getModelCacheBytes,
  importModelFromBlob,
  isModelCached,
  MODEL_CACHE_ENTRIES,
  type ModelCacheEntry,
  type ModelDownloadProgress,
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
  progress: ModelDownloadProgress | null
}

const EMPTY_ROW: ModelRowState = {
  cached: false,
  bytes: 0,
  busy: false,
  error: null,
  progress: null,
}

function formatRemainingLabel(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) return '正在计算剩余时间'
  if (remainingMs <= 0) return '即将完成'
  if (remainingMs < 1000) return '不到 1 秒'
  const seconds = Math.ceil(remainingMs / 1000)
  if (seconds < 60) return `约 ${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes >= 60) return `约 ${Math.ceil(minutes / 60)} 小时`
  return rest === 0 ? `约 ${minutes} 分钟` : `约 ${minutes} 分 ${rest} 秒`
}

function rowMeta(entry: ModelCacheEntry, row: ModelRowState): string {
  if (row.error) return row.error
  if (row.busy && row.progress?.phase === 'prepare') {
    return `${formatStorageSize(entry.totalBytes)} · 正在准备下载…`
  }
  if (row.busy && row.progress?.phase === 'verify') {
    const percent = Math.round(row.progress.ratio * 100)
    return `${formatStorageSize(entry.totalBytes)} · 正在校验 SHA-256… ${percent}%`
  }
  if (row.busy && row.progress?.phase === 'write') {
    return `${formatStorageSize(entry.totalBytes)} · 正在写入缓存…`
  }
  if (row.busy && row.progress) {
    const percent = Math.round(row.progress.ratio * 100)
    return `${formatStorageSize(row.progress.receivedBytes)} / ${formatStorageSize(entry.totalBytes)} · ${percent}% · ${formatRemainingLabel(row.progress.remainingMs)}`
  }
  if (row.cached) {
    return `${formatStorageSize(entry.totalBytes)} · 已缓存（${formatStorageSize(row.bytes)}）`
  }
  return `${formatStorageSize(entry.totalBytes)} · 未缓存`
}

export function ModelCacheView({ onBack }: ModelCacheViewProps) {
  const [states, setStates] = useState<Record<string, ModelRowState>>({})
  const [pendingClear, setPendingClear] = useState<ModelCacheEntry | undefined>(undefined)
  const { showSystemOpenDialog, dialog: openDialog } = useSystemOpenDialog()

  const patchRow = useCallback((url: string, next: Partial<ModelRowState>) => {
    setStates((prev) => ({
      ...prev,
      [url]: { ...(prev[url] ?? EMPTY_ROW), ...next },
    }))
  }, [])

  const refreshRow = useCallback(
    async (url: string) => {
      const [cached, bytes] = await Promise.all([isModelCached(url), getModelCacheBytes(url)])
      patchRow(url, { cached, bytes, progress: null })
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
    patchRow(entry.url, {
      busy: true,
      error: null,
      progress: {
        phase: 'prepare',
        receivedBytes: 0,
        totalBytes: entry.totalBytes,
        ratio: 0,
        remainingMs: Number.POSITIVE_INFINITY,
      },
    })
    try {
      await cacheModelUrl(entry.url, (progress) => {
        patchRow(entry.url, { progress })
      })
      await refreshRow(entry.url)
    } catch (cause) {
      patchRow(entry.url, {
        error: cause instanceof Error ? cause.message : String(cause),
        progress: null,
      })
    } finally {
      patchRow(entry.url, { busy: false, progress: null })
    }
  }

  const handleImport = async (entry: ModelCacheEntry) => {
    if (states[entry.url]?.busy) return
    const path = await showSystemOpenDialog({
      title: `导入 ${entry.label}`,
      selectionMode: 'file',
      acceptExtensions: ['onnx'],
    })
    if (!path) return
    patchRow(entry.url, {
      busy: true,
      error: null,
      progress: {
        phase: 'verify',
        receivedBytes: 0,
        totalBytes: entry.totalBytes,
        ratio: 0,
        remainingMs: Number.POSITIVE_INFINITY,
      },
    })
    try {
      const stat = await filesStat(path)
      if (!stat || stat.kind !== 'file') {
        throw new Error('未选择文件')
      }
      assertImportedModelSize(entry, stat.byteSize)
      const blob = await filesReadBlob(path)
      await importModelFromBlob(entry.url, blob, (progress) => {
        patchRow(entry.url, { progress })
      })
      await refreshRow(entry.url)
    } catch (cause) {
      patchRow(entry.url, {
        error: cause instanceof Error ? cause.message : String(cause),
        progress: null,
      })
    } finally {
      patchRow(entry.url, { busy: false, progress: null })
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
              const phase = row.progress?.phase
              const importing = row.busy && (phase === 'verify' || phase === 'write')
              const downloading =
                row.busy && !row.cached && !importing
              const inProgress = downloading || importing
              const percent = Math.round((row.progress?.ratio ?? 0) * 100)
              const badgeLabel = row.cached
                ? '已缓存'
                : importing
                  ? '导入中'
                  : downloading
                    ? '缓存中'
                    : '未缓存'
              const meta = rowMeta(entry, row)
              return (
                <div key={entry.url} class="settings__row settings__row--model-cache">
                  <span class="settings__row-name">
                    <span>{entry.label}</span>
                    <span
                      class={`settings__row-badge${
                        row.cached
                          ? ' settings__row-badge--ok'
                          : inProgress
                            ? ' settings__row-badge--busy'
                            : ' settings__row-badge--warn'
                      }`}
                    >
                      {badgeLabel}
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
                    <span class="settings__row-model-cache-actions">
                      <IosButton
                        size="compact"
                        disabled={row.busy}
                        onClick={() => void handleImport(entry)}
                      >
                        {importing
                          ? phase === 'write'
                            ? '写入中…'
                            : '校验中…'
                          : '导入'}
                      </IosButton>
                      <IosButton
                        size="compact"
                        disabled={row.busy}
                        onClick={() => void handleCache(entry)}
                      >
                        {downloading
                          ? phase === 'download'
                            ? `${percent}%`
                            : '准备中…'
                          : '缓存'}
                      </IosButton>
                    </span>
                  )}
                  <p
                    class={`settings__row-model-cache-meta${row.error ? ' settings__row-model-cache-meta--error' : ''}`}
                  >
                    {meta}
                  </p>
                  <div
                    class={`settings__row-model-cache-bar${inProgress ? '' : ' settings__row-model-cache-bar--idle'}`}
                    role="progressbar"
                    aria-hidden={inProgress ? undefined : 'true'}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={inProgress ? percent : 0}
                    aria-label={
                      inProgress
                        ? `${entry.label} ${importing ? '导入' : '下载'}进度 ${percent}%`
                        : undefined
                    }
                  >
                    <span
                      class="settings__row-model-cache-bar-fill"
                      style={{ width: `${inProgress ? percent : 0}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <p class="settings__section-footnote">
            权重缓存在浏览器 Cache API 中，与系统存储空间（虚拟文件系统 /
            IndexedDB）完全独立，不计入「存储空间」统计。默认从模型网关下载（R2，Proof-of-Work
            鉴权）；可在「开发者选项」改回同源 /assets。也可从文件 App 导入已有
            ONNX，导入时按 SHA-256 校验是否为对应权重。若显示已缓存但只有几
            KB，是误把页面写进了缓存，请清除后重新缓存。
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
      {openDialog}
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
