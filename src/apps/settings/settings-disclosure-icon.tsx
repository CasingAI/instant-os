import { ForwardIcon } from '../../icons/app-icons.tsx'

type SettingsDisclosureIconProps = {
  expanded?: boolean
}

export function SettingsDisclosureIcon({ expanded }: SettingsDisclosureIconProps = {}) {
  return (
    <span
      class={`settings__disclosure${expanded ? ' settings__disclosure--expanded' : ''}`}
      aria-hidden="true"
    >
      <ForwardIcon size={13} />
    </span>
  )
}
