import { useEffect, useRef, useState } from 'preact/hooks'
import {
  getSystemVolumeState,
  openSettingsSoundsView,
  setSystemMuted,
  setSystemVolume,
  subscribeSystemVolume,
  type SystemVolumeState,
} from './system-volume.ts'
import {
  beginSystemSoundVolumePreview,
  endSystemSoundVolumePreview,
  updateSystemSoundVolumePreview,
} from './system-sounds.ts'
import { loadSystemSoundSettings } from './system-sound-settings-storage.ts'
import { MenuBarPopover } from './menu-bar-popover.tsx'

/** 音量图标：静音时显示带斜杠的扬声器，否则按音量高低显示弧线。 */
export function MenuBarVolumeIcon({ muted, size = 14 }: { muted: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 9.5v5a1 1 0 0 0 1 1h3.1l4.36 3.6A1 1 0 0 0 13 18.3V5.7a1 1 0 0 0-1.54-.8L7.1 8.5H4a1 1 0 0 0-1 1Z"
        fill="currentColor"
      />
      {muted ? (
        <path
          d="m15.6 9.2 5.6 5.6m0-5.6-5.6 5.6"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      ) : (
        <>
          <path
            d="M16 8.2a1 1 0 0 1 1.42 1.3 3.9 3.9 0 0 1 0 4.9 1 1 0 1 1-1.5-1.32 1.9 1.9 0 0 0 0-2.26 1 1 0 0 1 .08-1.42Z"
            fill="currentColor"
          />
          <path
            d="M18.8 5.9a1 1 0 0 1 1.42 1.3 7.9 7.9 0 0 1 0 9.6 1 1 0 0 1-1.6-1.2 5.9 5.9 0 0 0 0-7.2 1 1 0 0 1 .18-1.5Z"
            fill="currentColor"
          />
        </>
      )}
    </svg>
  )
}

export function MenuBarVolumePanel() {
  const [state, setState] = useState<SystemVolumeState>(() => getSystemVolumeState())
  const previewingRef = useRef(false)

  useEffect(
    () =>
      subscribeSystemVolume(() => {
        const next = getSystemVolumeState()
        setState(next)
        if (next.muted && previewingRef.current) {
          previewingRef.current = false
          endSystemSoundVolumePreview()
        }
      }),
    [],
  )

  useEffect(() => {
    return () => {
      previewingRef.current = false
      endSystemSoundVolumePreview()
    }
  }, [])

  const volumePercent = Math.round(state.volume * 100)

  // 试听基准用系统提示音分轨音量；preview 增益内部会乘当前主音量
  const previewBaseVolume = loadSystemSoundSettings().volume

  const readSliderVolume = (el: HTMLInputElement): number => Number(el.value) / 100

  const handleVolumePointerDown = (event: PointerEvent) => {
    const el = event.currentTarget as HTMLInputElement
    try {
      el.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    previewingRef.current = true
    beginSystemSoundVolumePreview(previewBaseVolume)
  }

  const handleVolumeInput = (event: Event) => {
    const el = event.currentTarget as HTMLInputElement
    const next = readSliderVolume(el)
    setSystemVolume(next)
    if (!previewingRef.current) {
      previewingRef.current = true
      beginSystemSoundVolumePreview(previewBaseVolume)
      return
    }
    updateSystemSoundVolumePreview(previewBaseVolume)
  }

  const finishVolumeGesture = () => {
    if (!previewingRef.current) return
    previewingRef.current = false
    endSystemSoundVolumePreview()
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
    finishVolumeGesture()
  }

  const handleVolumeBlur = () => {
    finishVolumeGesture()
  }

  const muted = state.muted || volumePercent === 0

  return (
    <MenuBarPopover align="right" label="音量" flushBottom>
      <p class="menu-bar__popover-heading">音量</p>

      <button
        type="button"
        class="menu-bar__popover-row menu-bar__popover-row--button"
        aria-pressed={state.muted}
        onClick={() => {
          const nextMuted = !state.muted
          if (nextMuted && previewingRef.current) {
            previewingRef.current = false
            endSystemSoundVolumePreview()
          }
          setSystemMuted(nextMuted)
        }}
      >
        <span class="menu-bar__popover-row-label">静音</span>
        <span class="menu-bar__popover-row-value">{state.muted ? '已静音' : '未静音'}</span>
      </button>

      {!state.muted ? (
        <div class="menu-bar__volume-row">
          <MenuBarVolumeIcon muted={muted} size={14} />
          <input
            type="range"
            class="menu-bar__volume-slider"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            aria-label="系统音量"
            onPointerDown={handleVolumePointerDown}
            onInput={handleVolumeInput}
            onPointerUp={handleVolumePointerUp}
            onPointerCancel={handleVolumePointerUp}
            onBlur={handleVolumeBlur}
          />
          <span class="menu-bar__volume-percent">{volumePercent}%</span>
        </div>
      ) : null}

      <button type="button" class="menu-bar__popover-more" onClick={openSettingsSoundsView}>
        打开声音设置…
      </button>
    </MenuBarPopover>
  )
}
