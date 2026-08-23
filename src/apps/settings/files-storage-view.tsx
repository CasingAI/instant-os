import { useCallback, useEffect, useState } from 'preact/hooks'
import { DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import { osBootTimeMs } from '../../os/os-boot-time.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  loadDataSpaceFilesBreakdown,
  type DataSpaceFilesBreakdown,
} from '../files/files-data-space-breakdown.ts'
import { clearTmpCreatedBefore } from '../files/files-tmp.ts'
import { formatStorageSize } from './format-storage-size.ts'

type FilesStorageViewProps = {
  onBack: () => void
  onOpenSpaceSniffer: () => void
}

export function FilesStorageView({ onBack, onOpenSpaceSniffer }: FilesStorageViewProps) {
  const [breakdown, setBreakdown] = useState<DataSpaceFilesBreakdown | undefined>(undefined)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearStatus, setClearStatus] = useState<string | undefined>(undefined)

  const refresh = useCallback(() => {
    void loadDataSpaceFilesBreakdown().then(setBreakdown)
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener(DATA_STORAGE_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(DATA_STORAGE_CHANGED_EVENT, refresh)
  }, [refresh])

  const handleClearStaleTmp = useCallback(() => {
    if (clearBusy) return
    setClearBusy(true)
    setClearStatus('正在清理…')
    void clearTmpCreatedBefore(osBootTimeMs)
      .then((result) => {
        if (result.deletedRoots === 0) {
          setClearStatus('没有可清理的启动前临时文件')
        } else {
          setClearStatus(
            `已清理 ${result.deletedRoots} 个目录（约 ${formatStorageSize(result.reclaimBytes)}）`,
          )
        }
        refresh()
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setClearStatus(`清理失败：${message}`)
      })
      .finally(() => {
        setClearBusy(false)
      })
  }, [clearBusy, refresh])

  const rowSum = breakdown?.rows.reduce((sum, row) => sum + row.bytes, 0) ?? 0

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="存储空间" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">文件</h2>
          <p class="settings__section-subtitle">
            计入数据空间的文件系统占用。各应用 Data/Contents 在「应用」分类单独统计。
          </p>
          <div class="settings__box">
            <dl class="settings__form-row">
              <dt>合计</dt>
              <dd>{breakdown === undefined ? '计算中…' : formatStorageSize(breakdown.totalBytes)}</dd>
            </dl>
            {breakdown && breakdown.appDataBytes > 0 ? (
              <p class="settings__section-footnote">
                另有 {formatStorageSize(breakdown.appDataBytes)} 在「应用」分类（各应用 Data /
                Contents）。
              </p>
            ) : null}
          </div>
          <div class="settings__list">
            <div class="settings__list-head">
              <span>卷</span>
              <span>大小</span>
            </div>
            <div class="settings__list-body">
              {breakdown === undefined ? (
                <div class="settings__row settings__row--static">
                  <span class="settings__row-name">正在计算…</span>
                  <span class="settings__row-size">—</span>
                </div>
              ) : (
                breakdown.rows.map((row) => (
                  <div key={row.id} class="settings__row settings__row--static">
                    <span class="settings__row-name">
                      {row.label}
                      {row.hint ? (
                        <span class="settings__row-hint" title={row.hint}>
                          {' '}
                          ⓘ
                        </span>
                      ) : null}
                    </span>
                    <span class="settings__row-size">{formatStorageSize(row.bytes)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div class="settings__actions settings__actions--inline">
            <p class="settings__hint">
              临时文件长期保留；清理仅删除本次系统启动之前创建的目录，不影响当前运行中的终端。
              {breakdown && rowSum !== breakdown.totalBytes
                ? ` 分卷合计 ${formatStorageSize(rowSum)}，与上方合计存在差额时已单列「未归类」。`
                : ''}
            </p>
            <button type="button" class="settings__btn" onClick={onOpenSpaceSniffer}>
              在空间嗅探中查看
            </button>
            <button
              type="button"
              class="settings__btn"
              disabled={clearBusy}
              onClick={handleClearStaleTmp}
            >
              清空本次启动前的临时文件
            </button>
          </div>
          {clearStatus ? (
            <p class="settings__section-footnote" role="status">
              {clearStatus}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}
