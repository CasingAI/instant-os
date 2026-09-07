import { useState } from 'preact/hooks'
import { SettingsStepperRow } from '../../../../ui/settings-stepper-row.tsx'
import { DemoVariants, DemoVariant, SettingsGroup } from '../../ui-kit-demo-shared.tsx'

export default function SettingsStepperRowDemo() {
  const [fontSize, setFontSize] = useState(13)
  const [retries, setRetries] = useState(10)
  const [concurrency, setConcurrency] = useState(5)

  return (
    <DemoVariants>
      <DemoVariant label="点击弹出步进" wide>
        <div class="settings" style={{ position: 'relative', minHeight: 220 }}>
          <SettingsGroup>
            <SettingsStepperRow
              label="字号"
              value={fontSize}
              min={10}
              max={24}
              onChange={setFontSize}
            />
            <SettingsStepperRow
              label="空闲重试"
              value={retries}
              min={0}
              max={50}
              onChange={setRetries}
            />
            <SettingsStepperRow
              label="并发上限"
              value={concurrency}
              min={1}
              max={20}
              onChange={setConcurrency}
            />
          </SettingsGroup>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
