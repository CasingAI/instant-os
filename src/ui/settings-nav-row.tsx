import type { ComponentChildren, Ref } from 'preact'
import { ForwardIcon } from '../icons/app-icons.tsx'
import { settingsSecretMaskText } from './settings-secret-mask.ts'

type SettingsNavRowProps = {
  label: ComponentChildren
  value: string
  onClick: () => void
  disabled?: boolean
  selected?: boolean
  rowRef?: Ref<HTMLButtonElement>
  /** 已填密钥长度；有值时按长度显示与宽屏密码框相同数量的圆点。 */
  secretLength?: number
}

export function SettingsNavRow({
  label,
  value,
  onClick,
  disabled,
  selected,
  rowRef,
  secretLength,
}: SettingsNavRowProps) {
  const showSecret = secretLength !== undefined && secretLength > 0
  const className = [
    'settings__row',
    'settings__row--button',
    'settings__row--nav',
    selected ? 'settings__row--selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={rowRef}
      type="button"
      class={className}
      aria-current={selected ? 'true' : undefined}
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
