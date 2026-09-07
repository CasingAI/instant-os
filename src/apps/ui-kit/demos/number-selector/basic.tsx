import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { NumberSelector } from '../../../../ui/number-selector.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function NumberSelectorDemo() {
  const [fontSize, setFontSize] = useState(13)
  const [retries, setRetries] = useState(10)
  const [concurrency, setConcurrency] = useState(5)

  return (
    <DemoVariants>
      <DemoVariant label="点击弹出步进" wide>
        <div class="settings" style={{ position: 'relative', minHeight: 220 }}>
          <List variant="plain">
            <NumberSelector
              label="字号"
              value={fontSize}
              min={10}
              max={24}
              onChange={setFontSize}
            />
            <NumberSelector
              label="空闲重试"
              value={retries}
              min={0}
              max={50}
              onChange={setRetries}
            />
            <NumberSelector
              label="并发上限"
              value={concurrency}
              min={1}
              max={20}
              onChange={setConcurrency}
            />
          </List>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
