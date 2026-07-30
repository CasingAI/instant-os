import { useCallback, useEffect, useState } from 'preact/hooks'
import { DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import { osBootTimeMs } from '../../os/os-boot-time.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  DATA_SPACE_FILE_LOCATIONS,
  getFilesBytesByLocation,
} from '../files/files-storage.ts'
import type { FilesLocationId } from '../files/files-types.ts'
import { filesLocationDisplayName } from '../files/files-path.ts'
import { clearTmpCreatedBefore } from '../files/files-tmp.ts'
import { formatStorageSize } from './format-storage-size.ts'

type FilesStorageViewProps = {
  onBack: () => void
  onOpenSpaceSniffer: () => void
}

export function FilesStorageView({ onBack, onOpenSpaceSniffer }: FilesStorageViewProps) {
  const [bytesByLocation, setBytesByLocation] = useState<
    Partial<Record<FilesLocationId, number>> | undefined
  >(undefined)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearStatus, setClearStatus] = useState<string | undefined>(undefined)

  const refresh = useCallback(() => {
    void getFilesBytesByLocation().then((next) => {
      const map: Partial<Record<FilesLocationId, number>> = {}
      for (const entry of next) {
        map[entry.locationId] = entry.bytes
      }
      setBytesByLocation(map)
    })
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

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="存储空间" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">文件</h2>
          <p class="settings__section-subtitle">
            「文件」应用中计入数据空间的卷（含临时文件）
          </p>
          <div class="settings__list">
            <div class="settings__list-head">
              <span>名称</span>
              <span>大小</span>
            </div>
            <div class="settings__list-body">
              {DATA_SPACE_FILE_LOCATIONS.map((locationId) => {
                const bytes = bytesByLocation?.[locationId]
                return (
                  <div key={locationId} class="settings__row settings__row--static">
                    <span class="settings__row-name">
                      {filesLocationDisplayName(locationId)}
                    </span>
                    <span class="settings__row-size">
                      {bytes === undefined ? '计算中…' : formatStorageSize(bytes)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div class="settings__actions settings__actions--inline">
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
            <p class="settings__section-subtitle" role="status">
              {clearStatus}
            </p>
          ) : null}
          <p class="settings__section-subtitle">
            临时文件长期保留；清理仅删除本次系统启动之前创建的目录，不影响当前运行中的终端。
          </p>
        </section>
      </div>
    </div>
  )
}
