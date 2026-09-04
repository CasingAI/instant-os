import { useEffect, useMemo, useState } from 'preact/hooks'
import { Button } from '../../ui/button.tsx'
import { displayUrl } from '../browser/normalize-browser-url.ts'
import {
  cancelChromoDownload,
  retryChromoDownload,
} from './chromo-download-service.ts'
import {
  clearFinishedChromoDownloads,
  formatDownloadBytes,
  listChromoDownloads,
  removeChromoDownloadRecord,
  subscribeChromoDownloads,
  type ChromoDownloadRecord,
  type ChromoDownloadState,
} from './chromo-downloads.ts'
import { getDefaultFileOpenApp } from '../../os/file-open-registry.ts'
import { osOpenApp } from '../../os/os-open-app-bridge.ts'

type ChromoDownloadsPageProps = {
  revision?: number
}

function stateLabel(state: ChromoDownloadState): string {
  if (state === 'in-progress') return '下载中'
  if (state === 'completed') return '已完成'
  if (state === 'canceled') return '已取消'
  return '失败'
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function openPath(record: ChromoDownloadRecord, showInFiles: boolean): void {
  if (!record.path) {
    return
  }
  try {
    if (showInFiles) {
      osOpenApp('files', { documentId: record.path })
      return
    }
    osOpenApp(getDefaultFileOpenApp(record.filename) ?? 'files', { documentId: record.path })
  } catch {
    // OS 未就绪
  }
}

function sizeLabel(record: ChromoDownloadRecord): string {
  if (record.state === 'in-progress') {
    if (record.bytesTotal != null) {
      return `${formatDownloadBytes(record.bytesReceived)} / ${formatDownloadBytes(record.bytesTotal)}`
    }
    return formatDownloadBytes(record.bytesReceived)
  }
  if (record.bytesReceived > 0) {
    return formatDownloadBytes(record.bytesReceived)
  }
  return ''
}

function progressPercent(record: ChromoDownloadRecord): number | undefined {
  if (record.state !== 'in-progress' || !record.bytesTotal || record.bytesTotal <= 0) {
    return undefined
  }
  return Math.max(0, Math.min(100, Math.round((record.bytesReceived / record.bytesTotal) * 100)))
}

export function ChromoDownloadsPage(_props: ChromoDownloadsPageProps) {
  const [items, setItems] = useState<ChromoDownloadRecord[]>(() => listChromoDownloads())

  useEffect(() => {
    const sync = () => setItems(listChromoDownloads())
    sync()
    return subscribeChromoDownloads(sync)
  }, [])

  const inProgress = useMemo(
    () => items.filter((item) => item.state === 'in-progress').length,
    [items],
  )

  return (
    <div class="chromo-internal" role="document" aria-labelledby="chromo-downloads-title">
      <header class="chromo-internal__header">
        <h1 id="chromo-downloads-title" class="chromo-internal__title">
          下载内容
        </h1>
        <p class="chromo-internal__subtitle">
          {items.length === 0
            ? '保存到「下载」文件夹的文件会显示在这里'
            : inProgress > 0
              ? `${inProgress} 个进行中 · 共 ${items.length} 项`
              : `${items.length} 项`}
        </p>
      </header>

      {items.length === 0 ? (
        <div class="chromo-internal__empty">还没有下载记录</div>
      ) : (
        <div class="chromo-internal__body">
          <ul class="chromo-downloads-page__list">
            {items.map((item) => {
              const percent = progressPercent(item)
              return (
                <li
                  key={item.id}
                  class={[
                    'chromo-downloads-page__item',
                    `chromo-downloads-page__item--${item.state}`,
                  ].join(' ')}
                >
                  <div class="chromo-downloads-page__main">
                    <button
                      type="button"
                      class="chromo-downloads-page__name"
                      disabled={item.state !== 'completed' || !item.path}
                      onClick={() => openPath(item, false)}
                    >
                      {item.filename}
                    </button>
                    <div class="chromo-downloads-page__meta">
                      <span>{stateLabel(item.state)}</span>
                      {sizeLabel(item) ? <span>{sizeLabel(item)}</span> : null}
                      <span>{formatTime(item.endedAt ?? item.startedAt)}</span>
                      <span class="chromo-downloads-page__url" title={item.url}>
                        {displayUrl(item.url)}
                      </span>
                    </div>
                    {item.error && item.state === 'failed' ? (
                      <div class="chromo-downloads-page__error">{item.error}</div>
                    ) : null}
                    {percent != null ? (
                      <div
                        class="chromo-downloads-page__bar"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                      >
                        <span style={{ width: `${percent}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <div class="chromo-downloads-page__actions">
                    {item.state === 'in-progress' ? (
                      <button type="button" onClick={() => cancelChromoDownload(item.id)}>
                        取消
                      </button>
                    ) : null}
                    {item.state === 'completed' && item.path ? (
                      <>
                        <button type="button" onClick={() => openPath(item, false)}>
                          打开
                        </button>
                        <button type="button" onClick={() => openPath(item, true)}>
                          显示
                        </button>
                      </>
                    ) : null}
                    {item.state === 'failed' ? (
                      <button type="button" onClick={() => retryChromoDownload(item.id)}>
                        重试
                      </button>
                    ) : null}
                    {item.state !== 'in-progress' ? (
                      <button
                        type="button"
                        class="chromo-downloads-page__forget"
                        onClick={() => removeChromoDownloadRecord(item.id)}
                      >
                        清除
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {items.length > 0 ? (
        <footer class="chromo-internal__footer">
          <Button onClick={() => clearFinishedChromoDownloads()}>
            清除记录（保留文件）
          </Button>
        </footer>
      ) : null}
    </div>
  )
}
