import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsChoiceOptionList } from '../../ui/settings-choice-option-list.tsx'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import { isDesktopFolderId } from '../../os/desktop-folder-types.ts'
import {
  getDefaultLauncherLayout,
  loadLauncherLayout,
  reconcilePinnedDockItemIds,
  saveLauncherLayout,
} from '../../os/launcher-layout-storage.ts'
import {
  listDataCapacityPlans,
  loadDataCapacityBytes,
  saveDataCapacityBytes,
} from '../../os/data-capacity-settings-storage.ts'
import { getCombinedDataStorageBytes } from '../../os/device-data-storage.ts'
import type { AppId } from '../../os/types.ts'
import { formatStorageSize } from './format-storage-size.ts'

type ResetSettingsViewProps = {
  onBack: () => void
}

export function ResetSettingsView({ onBack }: ResetSettingsViewProps) {
  const [savedCapacityBytes, setSavedCapacityBytes] = useState(() => loadDataCapacityBytes())
  const [dataUsedBytes, setDataUsedBytes] = useState<number | undefined>(undefined)
  const [capacitySaveError, setCapacitySaveError] = useState<string | undefined>(undefined)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const refreshUsage = useCallback(() => {
    void getCombinedDataStorageBytes().then((bytes) => {
      setDataUsedBytes(bytes)
    })
  }, [])

  useEffect(() => {
    refreshUsage()
  }, [refreshUsage, savedCapacityBytes])

  const planOptions = useMemo(() => {
    return listDataCapacityPlans(savedCapacityBytes).map((bytes) => ({
      id: String(bytes),
      label: formatStorageSize(bytes),
    }))
  }, [savedCapacityBytes])

  const handleCapacityChange = (value: string) => {
    const nextBytes = Number(value)
    if (!Number.isFinite(nextBytes) || nextBytes <= 0) {
      return
    }
    if (dataUsedBytes !== undefined && nextBytes < dataUsedBytes) {
      setCapacitySaveError(
        `已用 ${formatStorageSize(dataUsedBytes)}，无法降到 ${formatStorageSize(nextBytes)}。请先删除一些内容。`,
      )
      return
    }
    const ok = saveDataCapacityBytes(nextBytes)
    if (!ok) {
      setCapacitySaveError('保存失败，设备存储空间可能已满。')
      return
    }
    setCapacitySaveError(undefined)
    setSavedCapacityBytes(loadDataCapacityBytes())
  }

  const handleReset = () => {
    const defaults = getDefaultLauncherLayout()
    const current = loadLauncherLayout()
    const builtinIds = new Set<string>(APP_REGISTRY.map((app) => app.id))

    const collectInstalled = (items: string[]): AppId[] => {
      const seen = new Set<AppId>()
      const result: AppId[] = []
      for (const id of items) {
        if (isDesktopFolderId(id)) {
          continue
        }
        if (builtinIds.has(id)) {
          continue
        }
        if (seen.has(id as AppId)) {
          continue
        }
        seen.add(id as AppId)
        result.push(id as AppId)
      }
      return result
    }

    const installedDesktop = collectInstalled(current.desktopIconOrder)
    const installedDock = collectInstalled(current.pinnedDockItemIds)

    const ok = saveLauncherLayout({
      layoutVersion: defaults.layoutVersion,
      pinnedDockItemIds: reconcilePinnedDockItemIds(
        [...defaults.pinnedDockItemIds, ...installedDock],
        defaults.desktopFolders,
      ),
      desktopIconOrder: [...defaults.desktopIconOrder, ...installedDesktop],
      desktopFolders: defaults.desktopFolders,
    })

    setConfirmOpen(false)
    setSaved(ok)
    setSaveError(!ok)
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">数据空间</h2>
          <p class="settings__section-subtitle">
            文件、应用数据与缓存共用此上限，可随时改到其他档位。
          </p>

          <SettingsChoiceOptionList
            ariaLabel="数据空间上限"
            options={planOptions}
            value={String(savedCapacityBytes)}
            onChange={handleCapacityChange}
          />

          {dataUsedBytes !== undefined ? (
            <p class="settings__section-footnote">
              已用 {formatStorageSize(dataUsedBytes)}。不能选低于已用空间的上限。
            </p>
          ) : undefined}

          {capacitySaveError ? (
            <p class="settings__section-footnote settings__form-status--error">
              {capacitySaveError}
            </p>
          ) : undefined}
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">还原</h2>
          <p class="settings__section-footnote">
            将桌面图标顺序、程序坞固定项恢复为出厂默认，并把开发工具收进默认文件夹。
          </p>

          <div class="settings__actions">
            <button
              type="button"
              class="settings__btn settings__btn--danger"
              onClick={() => setConfirmOpen(true)}
            >
              还原桌面布局
            </button>
            <p class="settings__hint">
              此操作会重置桌面图标顺序与程序坞固定项，并恢复「开发工具」默认文件夹；你安装的应用及其图标会保留。操作不可撤销。
            </p>
          </div>

          {saved ? (
            <p class="settings__section-footnote settings__form-status">
              桌面布局已还原为默认。
            </p>
          ) : undefined}
          {saveError ? (
            <p class="settings__section-footnote settings__form-status--error">
              保存失败，设备存储空间可能已满。
            </p>
          ) : undefined}
        </section>
      </div>

      {confirmOpen ? (
        <div
          class="settings__sheet-backdrop"
          role="presentation"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            class="settings__sheet"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-settings-sheet-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="settings__sheet-body">
              <div class="settings__sheet-icon" aria-hidden="true">
                !
              </div>
              <div class="settings__sheet-copy">
                <h3 class="settings__sheet-title" id="reset-settings-sheet-title">
                  确定要还原桌面布局吗？
                </h3>
                <p class="settings__sheet-message">
                  桌面图标顺序与程序坞固定项将恢复为默认，并重建「开发工具」文件夹；你安装的应用会保留。此操作不可撤销。
                </p>
              </div>
            </div>
            <div class="settings__sheet-actions">
              <button
                type="button"
                class="settings__btn settings__btn--plain"
                onClick={() => setConfirmOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                class="settings__btn settings__btn--danger"
                onClick={handleReset}
              >
                还原
              </button>
            </div>
          </div>
        </div>
      ) : undefined}
    </div>
  )
}
