import { useState } from 'preact/hooks'
import { SettingsInlineInputRow } from '../../../../ui/settings-inline-input-row.tsx'
import { DemoVariants, DemoVariant, SettingsGroup } from '../../ui-kit-demo-shared.tsx'

export default function SettingsInlineInputRowDemo() {
  const [name, setName] = useState('Instant')
  const [url, setUrl] = useState('https://example.com')
  const [secret, setSecret] = useState('')

  return (
    <DemoVariants>
      <DemoVariant label="文本 / URL / 密码" wide>
        <SettingsGroup>
          <SettingsInlineInputRow label="显示名称" value={name} onChange={setName} placeholder="名称" />
          <SettingsInlineInputRow
            label="服务地址"
            value={url}
            onChange={setUrl}
            type="url"
            placeholder="https://"
          />
          <SettingsInlineInputRow
            label="密钥"
            value={secret}
            onChange={setSecret}
            type="password"
            placeholder="可选"
          />
        </SettingsGroup>
      </DemoVariant>
    </DemoVariants>
  )
}
