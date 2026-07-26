import { useEffect, useState } from 'preact/hooks'
import { DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  DATA_SPACE_FILE_LOCATIONS,
  getFilesBytesByLocation,
} from '../files/files-storage.ts'
import type { FilesLocationId } from '../files/files-types.ts'
import { filesLocationDisplayName } from '../files/files-path.ts'
import { formatStorageSize } from './format-storage-size.ts'

type FilesStorageViewProps = {
  onBack: () => void
  onOpenSpaceSniffer: () => void
}

export function FilesStorageView({ onBack, onOpenSpaceSniffer }: FilesStorageViewProps) {
  const [bytesByLocation, setBytesByLocation] = useState<
    Partial<Record<FilesLocationId, number>> | undefined
  >(undefined)

  useEffect(() => {
    const refresh = () => {
      void getFilesBytesByLocation().then((next) => {
        const map: Partial<Record<FilesLocationId, number>> = {}
        for (const entry of next) {
          map[entry.locationId] = entry.bytes
        }
        setBytesByLocation(map)
      })
    }
    refresh()
    window.addEventListener(DATA_STORAGE_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(DATA_STORAGE_CHANGED_EVENT, refresh)
  }, [])

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="存储空间" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">文件</h2>
          <p class="settings__section-subtitle">
            「文件」应用中计入数据空间的卷
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
          </div>
        </section>
      </div>
    </div>
  )
}
