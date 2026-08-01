import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  SYSTEM_SOUND_PACKS,
  loadSystemSoundSettings,
  patchSystemSoundSettings,
  systemSoundPackLabel,
  type SystemSoundPack,
} from '../../os/system-sound-settings-storage.ts'
import {
  beginSystemSoundVolumePreview,
  endSystemSoundVolumePreview,
  playSystemSound,
  updateSystemSoundVolumePreview,
  type SystemSoundCue,
} from '../../os/system-sounds.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SETTINGS_WIDE_LAYOUT_MIN_WIDTH } from './settings-layout-breakpoints.ts'
import { SettingsChoicePickerView } from './settings-choice-picker-view.tsx'

type SoundSettingsViewProps = {
  onBack: () => void
}

/** 仿 iOS 6「声音和振动模式」列表：点选即可试听。 */
const PREVIEW_CUES: ReadonlyArray<{ cue: SystemSoundCue; label: string }> = [
  { cue: 'notification', label: '通知' },
  { cue: 'success', label: '成功' },
  { cue: 'error', label: '错误' },
  { cue: 'warning', label: '警告' },
  { cue: 'info', label: '信息' },
  { cue: 'open', label: '打开' },
  { cue: 'close', label: '关闭' },
  { cue: 'delete', label: '删除' },
  { cue: 'lock', label: '锁定' },
  { cue: 'unlock', label: '解锁' },
  { cue: 'complete', label: '完成' },
  { cue: 'volume-change', label: '音量调节' },
]

export function SoundSettingsView({ onBack }: SoundSettingsViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [wideLayout, setWideLayout] = useState(true)
  const [pickingPack, setPickingPack] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const volumePreviewingRef = useRef(false)
  const volumePercentLabelRef = useRef<HTMLParagraphElement>(null)
  const sliderRef = useRef<HTMLInputElement>(null)

  const initial = loadSystemSoundSettings()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [pack, setPack] = useState<SystemSoundPack>(initial.pack)
  const [volume, setVolume] = useState(initial.volume)

  const packOptions = useMemo(
    () => SYSTEM_SOUND_PACKS.map((id) => ({ id, label: systemSoundPackLabel(id) })),
    [],
  )

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const sync = () => {
      setWideLayout(host.clientWidth >= SETTINGS_WIDE_LAYOUT_MIN_WIDTH)
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      volumePreviewingRef.current = false
      endSystemSoundVolumePreview()
    }
  }, [])

  const commit = (patch: {
    enabled?: boolean
    pack?: SystemSoundPack
    volume?: number
  }): boolean => {
    if (!patchSystemSoundSettings(patch)) {
      setSaveError(true)
      return false
    }
    setSaveError(false)
    return true
  }

  const handleEnabledChange = (checked: boolean) => {
    if (!checked && volumePreviewingRef.current) {
      volumePreviewingRef.current = false
      endSystemSoundVolumePreview()
    }
    if (!commit({ enabled: checked })) return
    setEnabled(checked)
    if (checked) {
      playSystemSound('notification', { force: true })
    }
  }

  const readSliderVolume = (el: HTMLInputElement): number => Number(el.value) / 100

  const syncVolumeLabel = (next: number) => {
    const label = volumePercentLabelRef.current
    if (label) label.textContent = `当前 ${Math.round(next * 100)}%`
  }

  const handleVolumePointerDown = (event: PointerEvent) => {
    const el = event.currentTarget as HTMLInputElement
    try {
      el.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    const next = readSliderVolume(el)
    volumePreviewingRef.current = true
    beginSystemSoundVolumePreview(next)
  }

  const handleVolumeInput = (event: Event) => {
    const el = event.currentTarget as HTMLInputElement
    const next = readSliderVolume(el)
    syncVolumeLabel(next)
    if (!volumePreviewingRef.current) {
      volumePreviewingRef.current = true
      beginSystemSoundVolumePreview(next)
      return
    }
    updateSystemSoundVolumePreview(next)
  }

  const finishVolumeGesture = (el: HTMLInputElement) => {
    if (!volumePreviewingRef.current) return
    const next = readSliderVolume(el)
    volumePreviewingRef.current = false
    endSystemSoundVolumePreview()
    setVolume(next)
    syncVolumeLabel(next)
    void commit({ volume: next })
  }

  const handleVolumePointerUp = (event: PointerEvent) => {
    const el = event.currentTarget as HTMLInputElement
    try {
      if (el.hasPointerCapture?.(event.pointerId)) {
        el.releasePointerCapture(event.pointerId)
      }
    } catch {
      // ignore
    }
    finishVolumeGesture(el)
  }

  const handleVolumeBlur = (event: FocusEvent) => {
    finishVolumeGesture(event.currentTarget as HTMLInputElement)
  }

  const commitPack = (value: string) => {
    const next = value as SystemSoundPack
    if (next !== pack) {
      if (!commit({ pack: next })) return
      setPack(next)
    }
    playSystemSound('notification', { pack: next, force: true })
  }

  const previewCue = (cue: SystemSoundCue) => {
    playSystemSound(cue, { force: true })
  }

  if (pickingPack) {
    return (
      <div class="settings" ref={hostRef} data-settings-subpage>
        <SettingsChoicePickerView
          title="提示音风格"
          backLabel="声音"
          options={packOptions}
          value={pack}
          onChange={commitPack}
          onBack={() => setPickingPack(false)}
          closeOnSelect={false}
          footnote="点选即可试听。风格会应用到全部系统提示音。"
        />
      </div>
    )
  }

  const volumePercent = Math.round(volume * 100)

  return (
    <div class="settings" ref={hostRef}>
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">声音</h2>
          <p class="settings__section-subtitle">
            调节系统提示音音量与风格，效果类似 iOS 的「声音」设置。
          </p>

          <div class="settings__list">
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">系统提示音</span>
              <IosSwitch
                checked={enabled}
                onChange={handleEnabledChange}
                label="系统提示音"
              />
            </div>
          </div>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">铃声和提醒</h2>
          <div class="settings__box settings__sound-volume-box">
            <div
              class="settings__sound-volume-row"
              aria-disabled={!enabled ? 'true' : undefined}
            >
              <span class="settings__sound-volume-icon" aria-hidden="true">
                <VolumeQuietIcon />
              </span>
              <input
                ref={sliderRef}
                type="range"
                class="settings__emoji-offset-slider settings__sound-volume-slider"
                min={0}
                max={100}
                step={1}
                defaultValue={Math.round(volume * 100)}
                disabled={!enabled}
                aria-label="提示音音量"
                onPointerDown={handleVolumePointerDown}
                onInput={handleVolumeInput}
                onPointerUp={handleVolumePointerUp}
                onPointerCancel={handleVolumePointerUp}
                onBlur={handleVolumeBlur}
              />
              <span class="settings__sound-volume-icon" aria-hidden="true">
                <VolumeLoudIcon />
              </span>
            </div>
            {wideLayout ? (
              <p
                ref={volumePercentLabelRef}
                class="settings__section-footnote settings__sound-volume-footnote"
              >
                当前 {Math.round(volume * 100)}%
              </p>
            ) : null}
          </div>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">声音</h2>
          <div class="settings__list">
            <SettingsNavRow
              label="提示音风格"
              value={systemSoundPackLabel(pack)}
              onClick={() => setPickingPack(true)}
            />
          </div>
          <p class="settings__section-footnote">更改风格后，所有系统提示音都会切换。</p>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">试听</h2>
          <p class="settings__section-subtitle">点选可立即播放对应提示音。</p>
          <div class="settings__list">
            {PREVIEW_CUES.map(({ cue, label }) => (
              <button
                key={cue}
                type="button"
                class="settings__row settings__row--button"
                disabled={volumePercent === 0}
                onClick={() => previewCue(cue)}
              >
                <span class="settings__row-name">{label}</span>
              </button>
            ))}
          </div>
        </section>

        {saveError && (
          <p class="settings__section-footnote settings__form-status--error">
            保存失败，请检查设备存储空间。
          </p>
        )}
      </div>
    </div>
  )
}

function VolumeQuietIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M3 7.2h2.2L8.4 4.5v9L5.2 10.8H3V7.2Z"
        fill="currentColor"
        opacity="0.75"
      />
      <path
        d="M10.2 7.4c.55.45.9 1.15.9 1.9s-.35 1.45-.9 1.9"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        opacity="0.55"
      />
    </svg>
  )
}

function VolumeLoudIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M2.5 7.2h2.2L7.9 4.5v9L4.7 10.8H2.5V7.2Z"
        fill="currentColor"
        opacity="0.75"
      />
      <path
        d="M9.7 6.2c.9.7 1.45 1.75 1.45 2.95S10.6 11.4 9.7 12.1"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        opacity="0.55"
      />
      <path
        d="M11.7 4.6c1.45 1.1 2.35 2.8 2.35 4.7s-.9 3.6-2.35 4.7"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        opacity="0.4"
      />
    </svg>
  )
}
