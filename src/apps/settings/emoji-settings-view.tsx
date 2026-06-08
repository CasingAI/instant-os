import { useState } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
import { applyEmojiFontMode } from '../../fonts/ensure-apple-color-emoji-fonts.ts'
import {
  emojiFontLabel,
  loadDisplaySettings,
  saveDisplaySettings,
  type EmojiFontMode,
} from '../../os/display-settings-storage.ts'
type EmojiSettingsViewProps = {
  onBack: () => void
}

const EMOJI_FONT_OPTIONS: EmojiFontMode[] = ['auto', 'on', 'off']

const PREVIEW_EMOJIS = ['😀', '🎉', '📧', '🌐', '⚙️'] as const

export function EmojiSettingsView({ onBack }: EmojiSettingsViewProps) {
  const [mode, setMode] = useState<EmojiFontMode>(() => loadDisplaySettings().emojiFontMode)
  const [saveError, setSaveError] = useState(false)

  const handleSelect = async (next: EmojiFontMode) => {
    if (next === mode) {
      return
    }

    if (!saveDisplaySettings({ emojiFontMode: next })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    await applyEmojiFontMode(next)
    setMode(next)
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
          <div class="settings__box settings__emoji-preview" aria-hidden="true">
            {PREVIEW_EMOJIS.map((emoji) => (
              <span key={emoji} class="settings__emoji-preview-glyph">
                {emoji}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
