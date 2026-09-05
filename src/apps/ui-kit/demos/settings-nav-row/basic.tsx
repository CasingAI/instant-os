import { useState } from 'preact/hooks'
import { SettingsNavRow } from '../../../../ui/settings-nav-row.tsx'
import { DemoVariants, DemoVariant, SettingsGroup } from '../../ui-kit-demo-shared.tsx'

export default function SettingsNavRowDemo() {
  const [account, setAccount] = useState('user@example.com')
  const [clicked, setClicked] = useState(false)

  return (
    <DemoVariants>
      <DemoVariant label="普通导航" wide>
        <SettingsGroup>
          <SettingsNavRow
            label="账号设置"
            value={account}
            onClick={() => {
              setClicked(true)
              setAccount(account === 'user@example.com' ? '已进入' : 'user@example.com')
            }}
          />
          <SettingsNavRow label="存储空间" value="12.4 GB" onClick={() => setClicked(true)} />
          <SettingsNavRow label="关于本机" value="" onClick={() => setClicked(true)} />
        </SettingsGroup>
        {clicked && <p class="ui-kit-demo__status">已点击导航行</p>}
      </DemoVariant>
      <DemoVariant label="密钥掩码" wide>
        <SettingsGroup>
          <SettingsNavRow
            label="API Key"
            value=""
            secretLength={24}
            onClick={() => undefined}
          />
          <SettingsNavRow label="未设置密钥" value="未设置" onClick={() => undefined} />
        </SettingsGroup>
      </DemoVariant>
      <DemoVariant label="禁用">
        <SettingsGroup>
          <SettingsNavRow label="不可用" value="—" disabled onClick={() => undefined} />
        </SettingsGroup>
      </DemoVariant>
    </DemoVariants>
  )
}
