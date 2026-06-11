import type { Ref } from 'preact'
import { ForwardIcon } from '../icons/app-icons.tsx'
import { settingsSecretMaskText } from './settings-secret-mask.ts'

type SettingsNavRowProps = {
  label: string
  value: string
  onClick: () => void
  disabled?: boolean
  rowRef?: Ref<HTMLButtonElement>
  /** 已填密钥长度；有值时按长度显示与宽屏密码框相同数量的圆点。 */
  secretLength?: number
}

export function SettingsNavRow({
  label,
  value,
  onClick,
  disabled,
  rowRef,
  secretLength,
}: SettingsNavRowProps) {
  const showSecret = secretLength !== undefined && secretLength > 0

  return (
    <button
      ref={rowRef}
      type="button"
      class="settings__row settings__row--button settings__row--nav"
      disabled={disabled}
      onClick={onClick}
    >
      <span class="settings__row-name">{label}</span>
      {showSecret ? (
        <span class="settings__row-size settings__secret-mask" aria-label="已设置">
          {settingsSecretMaskText(secretLength)}
        </span>
      ) : (
        <span class="settings__row-size">{value}</span>
      )}
      <span class="settings__disclosure" aria-hidden="true">
        <ForwardIcon size={13} />
      </span>
    </button>
  )
}
