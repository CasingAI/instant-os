import { useRef, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { applyDockSettingsVariables } from '../../dock/apply-dock-settings.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import {
  DOCK_SIZE_TIERS,
  dockSizeTierFromIndex,
  dockSizeTierLabel,
  dockSizeTierStopPercent,
  dockSizeTierToIndex,
  loadDockSettings,
  patchDockSettings,
  resolveDockIconSizePx,
  resolveDockSizeScale,
  resolveDockSizeTier,
  type DockSizeTier,
} from '../../dock/dock-settings-storage.ts'
import type { BuiltinAppId } from '../../os/types.ts'

type DockSettingsViewProps = {
  onBack: () => void
}

const PREVIEW_BUILTIN_APP_IDS: readonly BuiltinAppId[] = ['browser', 'mail', 'settings']

export function DockSettingsView({ onBack }: DockSettingsViewProps) {
  const [sizeTier, setSizeTier] = useState<DockSizeTier>(() => resolveDockSizeTier(loadDockSettings()))
  const [saveError, setSaveError] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const iconSize = resolveDockIconSizePx(resolveDockSizeScale({ sizeTier }))
  const tierIndex = dockSizeTierToIndex(sizeTier)

  const commitSizeTier = (nextTier: DockSizeTier) => {
    if (nextTier === sizeTier) {
      return
    }

    setSizeTier(nextTier)
    if (!patchDockSettings({ sizeTier: nextTier })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    applyDockSettingsVariables({ sizeTier: nextTier })
  }

  const pickTierFromClientX = (clientX: number) => {
    const track = trackRef.current
    if (!track) {
      return
    }

    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) {
      return
    }

    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const nextIndex = Math.round(ratio * (DOCK_SIZE_TIERS.length - 1))
    commitSizeTier(dockSizeTierFromIndex(nextIndex))
  }

  const handleTrackPointerDown = (event: PointerEvent) => {
    const track = trackRef.current
    if (!track) {
      return
    }

    draggingRef.current = true
    track.setPointerCapture(event.pointerId)
    pickTierFromClientX(event.clientX)
  }

  const handleTrackPointerMove = (event: PointerEvent) => {
    if (!draggingRef.current) {
      return
    }
    pickTierFromClientX(event.clientX)
  }

  const handleTrackPointerEnd = (event: PointerEvent) => {
    if (!draggingRef.current) {
      return
    }

    draggingRef.current = false
    trackRef.current?.releasePointerCapture(event.pointerId)
  }

  const handleTrackKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      commitSizeTier(dockSizeTierFromIndex(tierIndex - 1))
      return
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      commitSizeTier(dockSizeTierFromIndex(tierIndex + 1))
    }
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section settings__dock-size-section">
          <h2 class="settings__section-title">程序坞</h2>
          <p class="settings__section-footnote">调整程序坞图标大小。更改会立即应用到桌面。</p>

          <div class="settings__box settings__dock-size-preview" aria-hidden="true">
            <div class="settings__dock-size-preview-wallpaper" />
            <div class="settings__dock-size-preview-dock">
              <div class="settings__dock-size-preview-plate">
                {PREVIEW_BUILTIN_APP_IDS.map((appId) => {
                  const app = getAppDefinition(appId)
                  if (!app) {
                    return undefined
                  }
                  const Icon = app.icon
                  return (
                    <span key={appId} class="settings__dock-size-preview-item">
                      <Icon size={iconSize} />
                    </span>
                  )
                })}
                <span class="settings__dock-size-preview-item">
                  <GeneratedAppIcon emoji="🚀" themeColor="#5856d6" size={iconSize} />
                </span>
              </div>
            </div>
          </div>

          <div class="settings__emoji-offset-control settings__emoji-offset-control--dock-size">
            <div class="settings__emoji-offset-control-head">
              <span class="settings__emoji-offset-control-label">大小</span>
              <span class="settings__dock-size-current">{dockSizeTierLabel(sizeTier)}</span>
            </div>
            <div class="settings__dock-size-track-wrap">
              <div
                ref={trackRef}
                class="settings__dock-size-track"
                role="slider"
                tabIndex={0}
                aria-valuemin={0}
                aria-valuemax={DOCK_SIZE_TIERS.length - 1}
                aria-valuenow={tierIndex}
                aria-valuetext={dockSizeTierLabel(sizeTier)}
                onPointerDown={handleTrackPointerDown}
                onPointerMove={handleTrackPointerMove}
                onPointerUp={handleTrackPointerEnd}
                onPointerCancel={handleTrackPointerEnd}
                onKeyDown={handleTrackKeyDown}
              >
                <div class="settings__dock-size-track-line" aria-hidden="true" />
                <div
                  class="settings__dock-size-track-thumb"
                  style={{ left: `${dockSizeTierStopPercent(tierIndex)}%` }}
                  aria-hidden="true"
                />
              </div>
              <div class="settings__dock-size-tier-labels">
                {DOCK_SIZE_TIERS.map((tier, index) => (
                  <button
                    key={tier}
                    type="button"
                    class={`settings__dock-size-tier-label${
                      tier === sizeTier ? ' settings__dock-size-tier-label--active' : ''
                    }${index === 0 ? ' settings__dock-size-tier-label--start' : ''}${
                      index === DOCK_SIZE_TIERS.length - 1 ? ' settings__dock-size-tier-label--end' : ''
                    }`}
                    style={
                      index === 0 || index === DOCK_SIZE_TIERS.length - 1
                        ? undefined
                        : { left: `${dockSizeTierStopPercent(index)}%` }
                    }
                    aria-label={dockSizeTierLabel(tier)}
                    aria-pressed={tier === sizeTier}
                    onClick={() => commitSizeTier(tier)}
                  >
                    {dockSizeTierLabel(tier)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {saveError && (
            <p class="settings__section-footnote settings__form-status--error">
              保存失败，设备存储空间可能已满。
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
