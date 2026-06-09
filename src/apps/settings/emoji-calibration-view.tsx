import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'
import { applyEmojiFontMode } from '../../fonts/ensure-apple-color-emoji-fonts.ts'
import { EMOJI_CALIBRATION_GLYPHS } from '../../fonts/emoji-calibration-glyphs.ts'
import { EMOJI_MIXED_PREVIEW_LINES } from '../../fonts/emoji-mixed-preview-lines.ts'
import {
  applyEmojiOffsetVariables,
  formatEmojiOffsetPercent,
  parseEmojiOffsetPercentInput,
  resolveEmojiOffsetEm,
} from '../../fonts/emoji-offset.ts'
import {
  measureIconEmojiOffsetWithCalibrationProgress,
  resolveActiveEmojiFontFamily,
  type EmojiCalibrationPhase,
  type EmojiCalibrationProgress,
} from '../../fonts/measure-emoji-visual-offset.ts'
import {
  loadDisplaySettings,
  patchDisplaySettings,
  type EmojiFontMode,
} from '../../os/display-settings-storage.ts'

type EmojiCalibrationViewProps = {
  onBack: () => void
}

const ICON_PREVIEW_TILE_SIZE = 48
const OFFSET_SLIDER_MIN = -0.3
const OFFSET_SLIDER_MAX = 0.3
const OFFSET_SLIDER_STEP = 0.0025

type CalibrationSlot = {
  emoji: string
  phase: EmojiCalibrationPhase
  offsetEm?: number
}

type CalibrationStage = 'idle' | 'running' | 'complete' | 'error'

function clampOffsetEm(value: number): number {
  return Math.min(OFFSET_SLIDER_MAX, Math.max(OFFSET_SLIDER_MIN, value))
}

function roundOffsetEm(value: number): number {
  return Math.round(value * 10000) / 10000
}

function createInitialSlots(showIcons = true): CalibrationSlot[] {
  return EMOJI_CALIBRATION_GLYPHS.map((emoji) => ({
    emoji,
    phase: showIcons ? ('done' as const) : ('pending' as const),
  }))
}

export function EmojiCalibrationView({ onBack }: EmojiCalibrationViewProps) {
  const [mode] = useState<EmojiFontMode>(() => loadDisplaySettings().emojiFontMode)
  const [offsetEm, setOffsetEm] = useState(() => resolveEmojiOffsetEm())
  const [offsetInput, setOffsetInput] = useState(() => formatEmojiOffsetPercent(resolveEmojiOffsetEm()))
  const [saveError, setSaveError] = useState(false)
  const [calibrationError, setCalibrationError] = useState<string | undefined>(undefined)
  const [stage, setStage] = useState<CalibrationStage>('idle')
  const [statusMessage, setStatusMessage] = useState('点击下方按钮，逐个加载图标并测量垂直偏移。')
  const [slots, setSlots] = useState<CalibrationSlot[]>(createInitialSlots)
  const iconPreviewRef = useRef<HTMLDivElement>(null)
  const calibrationRunRef = useRef(0)

  useEffect(() => {
    setOffsetInput(formatEmojiOffsetPercent(offsetEm))
  }, [offsetEm])

  const persistOffset = useCallback((nextEm: number) => {
    if (!patchDisplaySettings({ emojiOffsetEm: nextEm })) {
      setSaveError(true)
      return false
    }

    setSaveError(false)
    applyEmojiOffsetVariables({ ...loadDisplaySettings(), emojiOffsetEm: nextEm, emojiFontMode: mode })
    return true
  }, [mode])

  const commitOffset = (nextEm: number) => {
    const clamped = roundOffsetEm(clampOffsetEm(nextEm))
    setOffsetEm(clamped)
    persistOffset(clamped)
  }

  const updateSlot = (progress: EmojiCalibrationProgress) => {
    setSlots((current) =>
      current.map((slot, index) => {
        if (index !== progress.index) {
          return slot
        }

        return {
          emoji: progress.emoji,
          phase: progress.phase,
          offsetEm: progress.offsetEm ?? slot.offsetEm,
        }
      }),
    )
  }

  const handleStartCalibration = async () => {
    const runId = calibrationRunRef.current + 1
    calibrationRunRef.current = runId

    setCalibrationError(undefined)
    setStage('running')
    setStatusMessage('准备字体…')
    setSlots(createInitialSlots(false))

    try {
      await applyEmojiFontMode(mode)
      await document.fonts.ready

      if (calibrationRunRef.current !== runId) {
        return
      }

      setStatusMessage('逐个加载图标…')

      const measured = await measureIconEmojiOffsetWithCalibrationProgress(
        EMOJI_CALIBRATION_GLYPHS,
        resolveActiveEmojiFontFamily(),
        ICON_PREVIEW_TILE_SIZE,
        undefined,
        {
          appearDelayMs: 420,
          measureDelayMs: 560,
          onProgress: (progress) => {
            if (calibrationRunRef.current !== runId) {
              return
            }

            updateSlot(progress)

            if (progress.phase === 'appear') {
              setStatusMessage(`加载 ${progress.emoji}…`)
              return
            }

            if (progress.phase === 'measure') {
              setStatusMessage(`分析 ${progress.emoji} 像素分布…`)
              return
            }

            if (progress.phase === 'done') {
              setStatusMessage(
                `${progress.emoji} 完成（${formatEmojiOffsetPercent(progress.offsetEm ?? 0)}）`,
              )
              return
            }

            if (progress.phase === 'failed') {
              setStatusMessage(`${progress.emoji} 测量失败，已跳过`)
            }
          },
          resolveTileElement: (index) =>
            iconPreviewRef.current?.querySelectorAll<HTMLElement>('.app-icon-tile__tile')[index],
        },
      )

      if (calibrationRunRef.current !== runId) {
        return
      }

      if (measured === undefined) {
        setStage('error')
        setCalibrationError('偏移测量失败，请确认内置字体已加载后重试。')
        setStatusMessage('测量未完成')
        return
      }

      commitOffset(measured)
      setStage('complete')
      setStatusMessage(`校准完成：${formatEmojiOffsetPercent(measured)}`)
    } catch {
      if (calibrationRunRef.current !== runId) {
        return
      }

      setStage('error')
      setCalibrationError('偏移测量失败，请稍后重试。')
      setStatusMessage('测量未完成')
    }
  }

  const calibrating = stage === 'running'

  return (
    <div class="settings">
      <div class="settings__nav">
        <button type="button" class="settings__nav-back" onClick={onBack}>
          <span class="settings__nav-back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          表情符号
        </button>
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section settings__emoji-calibration-section">
          <h2 class="settings__section-title">垂直偏移校正</h2>
          <p class="settings__section-footnote settings__emoji-calibration-status">{statusMessage}</p>

          <div
            ref={iconPreviewRef}
            class={`settings__box settings__emoji-calibration-stage${
              calibrating ? ' settings__emoji-calibration-stage--running' : ''
            }`}
            aria-live="polite"
          >
            <div class="settings__emoji-calibration-grid">
              {slots.map((slot) => (
                <div
                  key={slot.emoji}
                  class={`settings__emoji-calibration-slot settings__emoji-calibration-slot--${slot.phase}`}
                >
                  <div class="settings__emoji-calibration-slot-icon">
                    <AppIconTile color="#8e8e93" size={ICON_PREVIEW_TILE_SIZE} showDesignGrid>
                      <span
                        class="app-icon-tile__emoji"
                        style={{ fontSize: `${ICON_PREVIEW_TILE_SIZE * (50 / 72)}px` }}
                      >
                        {slot.emoji}
                      </span>
                    </AppIconTile>
                    {slot.phase === 'measure' && (
                      <span class="settings__emoji-calibration-scan" aria-hidden="true" />
                    )}
                  </div>
                  <span class="settings__emoji-calibration-slot-label">
                    {slot.phase === 'done' && slot.offsetEm !== undefined
                      ? formatEmojiOffsetPercent(slot.offsetEm)
                      : slot.emoji}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            class="settings__btn settings__btn--default settings__emoji-calibration-start-btn"
            disabled={calibrating}
            onClick={handleStartCalibration}
          >
            {calibrating ? '校准中…' : stage === 'complete' ? '重新校准' : '开始校准'}
          </button>

          <div class="settings__emoji-offset-control">
            <div class="settings__emoji-offset-control-head">
              <span class="settings__emoji-offset-control-label">手动微调</span>
            </div>
            <div class="settings__emoji-offset-slider-row">
              <input
                type="range"
                class="settings__emoji-offset-slider"
                min={OFFSET_SLIDER_MIN}
                max={OFFSET_SLIDER_MAX}
                step={OFFSET_SLIDER_STEP}
                value={offsetEm}
                disabled={calibrating}
                aria-label="表情垂直偏移"
                onInput={(event) => {
                  const nextEm = Number((event.currentTarget as HTMLInputElement).value)
                  setOffsetInput(formatEmojiOffsetPercent(nextEm))
                  commitOffset(nextEm)
                }}
              />
              <input
                type="text"
                class="settings__input settings__emoji-offset-input"
                inputMode="decimal"
                aria-label="表情垂直偏移百分比"
                value={offsetInput}
                disabled={calibrating}
                onInput={(event) => {
                  setOffsetInput((event.currentTarget as HTMLInputElement).value)
                }}
                onBlur={(event) => {
                  const parsed = parseEmojiOffsetPercentInput((event.currentTarget as HTMLInputElement).value)
                  if (parsed === undefined) {
                    setOffsetInput(formatEmojiOffsetPercent(offsetEm))
                    return
                  }
                  commitOffset(parsed)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') {
                    return
                  }
                  const parsed = parseEmojiOffsetPercentInput((event.currentTarget as HTMLInputElement).value)
                  if (parsed === undefined) {
                    setOffsetInput(formatEmojiOffsetPercent(offsetEm))
                    return
                  }
                  commitOffset(parsed)
                }}
              />
            </div>
          </div>

          <div class="settings__emoji-offset-block">
            <h3 class="settings__emoji-offset-subtitle">文字混排预览</h3>
            <div class="settings__box settings__emoji-mixed-preview" aria-hidden="true">
              {EMOJI_MIXED_PREVIEW_LINES.map((line) => (
                <p key={line.emoji} class="settings__emoji-mixed-line">
                  {line.before}
                  <span class="settings__emoji-preview-glyph">{line.emoji}</span>
                  {line.after}
                </p>
              ))}
            </div>
          </div>

          {calibrationError && (
            <p class="settings__section-footnote settings__form-status--error">{calibrationError}</p>
          )}
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
