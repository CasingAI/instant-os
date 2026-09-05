import { useState } from 'preact/hooks'
import { SettingsSwitchRow } from '../../../../ui/settings-switch-row.tsx'
import { DemoVariants, DemoVariant, SettingsGroup } from '../../ui-kit-demo-shared.tsx'

export default function SettingsSwitchRowDemo() {
  const [notifications, setNotifications] = useState(true)
  const [sounds, setSounds] = useState(false)
  const [badge, setBadge] = useState(true)

  return (
    <DemoVariants>
      <DemoVariant label="开关组合" wide>
        <SettingsGroup>
          <SettingsSwitchRow
            label="启用通知"
            checked={notifications}
            onChange={setNotifications}
          />
          <SettingsSwitchRow label="提示音" checked={sounds} onChange={setSounds} />
          <SettingsSwitchRow label="角标" checked={badge} onChange={setBadge} />
        </SettingsGroup>
      </DemoVariant>
    </DemoVariants>
  )
}
