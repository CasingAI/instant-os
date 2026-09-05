import { useState } from 'preact/hooks'
import { CheckToggle } from '../../../../ui/check-toggle.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function CheckToggleDemo() {
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  const [c, setC] = useState(true)
  const [d, setD] = useState(false)

  return (
    <DemoVariants>
      <DemoVariant label="默认 · 选中">
        <div class="ui-kit-demo__row ui-kit-demo__row--labeled">
          <CheckToggle checked={a} onChange={setA} label="选中" />
          <span class="ui-kit-demo__hint">选中</span>
        </div>
      </DemoVariant>
      <DemoVariant label="默认 · 未选">
        <div class="ui-kit-demo__row ui-kit-demo__row--labeled">
          <CheckToggle checked={b} onChange={setB} label="未选" />
          <span class="ui-kit-demo__hint">未选</span>
        </div>
      </DemoVariant>
      <DemoVariant label="small">
        <div class="ui-kit-demo__row">
          <CheckToggle checked={c} onChange={setC} label="小尺寸选中" size="small" />
          <CheckToggle checked={d} onChange={setD} label="小尺寸未选" size="small" />
        </div>
      </DemoVariant>
      <DemoVariant label="disabled">
        <div class="ui-kit-demo__row">
          <CheckToggle checked={true} label="禁用选中" disabled />
          <CheckToggle checked={false} label="禁用未选" disabled />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
