import { useEffect, useState } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
import { SettingsDisclosureIcon } from './settings-disclosure-icon.tsx'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'
import { applyEmojiFontMode } from '../../fonts/ensure-apple-color-emoji-fonts.ts'
import { EMOJI_MIXED_PREVIEW_LINES } from '../../fonts/emoji-mixed-preview-lines.ts'
import { EMOJI_PREVIEW_GLYPHS } from '../../fonts/emoji-preview-glyphs.ts'
import { formatEmojiOffsetPercent, resolveEmojiOffsetEm } from '../../fonts/emoji-offset.ts'
import {
  emojiFontLabel,
  loadDisplaySettings,
  patchDisplaySettings,
  type EmojiFontMode,
} from '../../os/display-settings-storage.ts'

type EmojiSettingsViewProps = {
  onBack: () => void
  onOpenCalibration: () => void
}

const EMOJI_FONT_OPTIONS: EmojiFontMode[] = ['auto', 'on', 'off']
const ICON_PREVIEW_TILE_SIZE = 48

export function EmojiSettingsView({ onBack, onOpenCalibration }: EmojiSettingsViewProps) {
  const [mode, setMode] = useState<EmojiFontMode>(() => loadDisplaySettings().emojiFontMode)
  const [offsetEm, setOffsetEm] = useState(() => resolveEmojiOffsetEm())
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    setOffsetEm(resolveEmojiOffsetEm())
  }, [mode])

  const handleSelect = async (next: EmojiFontMode) => {
    if (next === mode) {
      return
    }

    if (!patchDisplaySettings({ emojiFontMode: next })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    await applyEmojiFontMode(next)
    setMode(next)
    setOffsetEm(resolveEmojiOffsetEm({ ...loadDisplaySettings(), emojiFontMode: next }))
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <button type="button" class="settings__nav-back" onClick={onBack}>
          <span class="settings__nav-back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          显示
        </button>
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">内置表情符号</h2>
          <div class="settings__list" role="radiogroup" aria-label="内置表情符号">
            {EMOJI_FONT_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                class="settings__option-row"
                role="radio"
                aria-checked={mode === option}
                onClick={() => handleSelect(option)}
              >
                <span class="settings__option-label">{emojiFontLabel(option)}</span>
                {mode === option && (
                  <span class="settings__option-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
          <p class="settings__section-footnote">
            自动：系统无 Apple Color Emoji 时加载内置字体；开启：始终使用内置字体；关闭：不加载内置字体，使用系统表情。
          </p>
          {saveError && (
            <p class="settings__section-footnote settings__form-status--error">
              保存失败，设备存储空间可能已满。
            </p>
          )}
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">预览</h2>
          <div class="settings__emoji-offset-block">
            <h3 class="settings__emoji-offset-subtitle">应用图标</h3>
            <div class="settings__box settings__emoji-offset-icon-preview" aria-hidden="true">
              {EMOJI_PREVIEW_GLYPHS.map((emoji) => (
                <AppIconTile key={emoji} color="#8e8e93" size={ICON_PREVIEW_TILE_SIZE}>
                  <span
                    class="app-icon-tile__emoji"
                    style={{ fontSize: `${ICON_PREVIEW_TILE_SIZE * (50 / 72)}px` }}
                  >
                    {emoji}
                  </span>
                </AppIconTile>
              ))}
            </div>
          </div>

          <div class="settings__emoji-offset-block">
            <h3 class="settings__emoji-offset-subtitle">文字混排</h3>
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
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">校正</h2>
          <div class="settings__list">
            <button
              type="button"
              class="settings__row settings__row--button settings__row--nav"
              onClick={onOpenCalibration}
            >
              <span class="settings__row-name">垂直偏移校正</span>
              <span class="settings__row-size">{formatEmojiOffsetPercent(offsetEm)}</span>
              <SettingsDisclosureIcon />
            </button>
          </div>
          <p class="settings__section-footnote">
            逐个加载图标并测量垂直偏移，也可手动微调。偏移按字号比例（em）应用。
          </p>
        </section>
      </div>
    </div>
  )
}
