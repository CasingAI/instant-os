import { useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  loadWallpaperSettings,
  patchWallpaperSettings,
} from '../../os/wallpaper-settings-storage.ts'
import { BUILTIN_WALLPAPERS, wallpaperPreviewStyle } from '../../os/wallpapers.ts'

type WallpaperViewProps = {
  onBack: () => void
}

export function WallpaperView({ onBack }: WallpaperViewProps) {
  const [selectedId, setSelectedId] = useState(() => loadWallpaperSettings().wallpaperId)
  const [saveError, setSaveError] = useState(false)

  const handleSelect = (wallpaperId: string) => {
    if (wallpaperId === selectedId) {
      return
    }

    if (!patchWallpaperSettings({ wallpaperId })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setSelectedId(wallpaperId)
  }

  const gradients = BUILTIN_WALLPAPERS.filter((wallpaper) => wallpaper.kind === 'gradient')
  const patterns = BUILTIN_WALLPAPERS.filter((wallpaper) => wallpaper.kind === 'pattern')
  const solids = BUILTIN_WALLPAPERS.filter((wallpaper) => wallpaper.kind === 'solid')

  const renderWallpaperTile = (wallpaper: (typeof BUILTIN_WALLPAPERS)[number]) => (
    <button
      key={wallpaper.id}
      type="button"
      class={`settings__wallpaper-tile${selectedId === wallpaper.id ? ' settings__wallpaper-tile--selected' : ''}`}
      role="radio"
      aria-checked={selectedId === wallpaper.id}
      aria-label={wallpaper.name}
      onClick={() => handleSelect(wallpaper.id)}
    >
      <span
        class="settings__wallpaper-preview"
        style={wallpaperPreviewStyle(wallpaper)}
        aria-hidden="true"
      />
      <span class="settings__wallpaper-name">{wallpaper.name}</span>
      {selectedId === wallpaper.id && (
        <span class="settings__wallpaper-check" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  )

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">渐变</h2>
          <div class="settings__wallpaper-grid" role="radiogroup" aria-label="渐变壁纸">
            {gradients.map(renderWallpaperTile)}
          </div>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">图案</h2>
          <div class="settings__wallpaper-grid" role="radiogroup" aria-label="图案壁纸">
            {patterns.map(renderWallpaperTile)}
          </div>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">纯色</h2>
          <div class="settings__wallpaper-grid" role="radiogroup" aria-label="纯色壁纸">
            {solids.map(renderWallpaperTile)}
          </div>
        </section>

        <p class="settings__section-footnote">目前仅支持内置壁纸。</p>
        {saveError && (
          <p class="settings__section-footnote settings__form-status--error">
            保存失败，设备存储空间可能已满。
          </p>
        )}
      </div>
    </div>
  )
}
