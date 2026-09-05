import { useState } from 'preact/hooks'
import { SettingsCheckRow } from '../../../../ui/settings-check-row.tsx'
import { DemoVariants, DemoVariant, SettingsGroup } from '../../ui-kit-demo-shared.tsx'

export default function SettingsCheckRowDemo() {
  const [vision, setVision] = useState(true)
  const [speech, setSpeech] = useState(false)
  const [tts, setTts] = useState(false)

  return (
    <DemoVariants>
      <DemoVariant label="可切换勾选" wide>
        <SettingsGroup>
          <SettingsCheckRow label="图像识别" checked={vision} onChange={setVision} />
          <SettingsCheckRow label="语音识别" checked={speech} onChange={setSpeech} />
          <SettingsCheckRow label="语音合成" checked={tts} onChange={setTts} />
        </SettingsGroup>
      </DemoVariant>
      <DemoVariant label="禁用 / 锁定项" wide>
        <SettingsGroup>
          <SettingsCheckRow
            label="文本"
            checked
            disabled
            onChange={() => undefined}
          />
          <SettingsCheckRow
            label="语音识别"
            checked={false}
            disabled
            onChange={() => undefined}
          />
          <SettingsCheckRow
            label="语音合成"
            checked={false}
            disabled
            onChange={() => undefined}
          />
        </SettingsGroup>
        <p class="ui-kit-demo__status">禁用项使用灰底灰字，勾也为灰色</p>
      </DemoVariant>
    </DemoVariants>
  )
}
