import { useState } from 'preact/hooks'
import { Checkbox } from '../../../../ui/checkbox.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function CheckboxDemo() {
  const [a, setA] = useState(false)
  const [b, setB] = useState(true)

  return (
    <DemoVariants>
      <DemoVariant label="未勾选 / 已勾选">
        <div class="ui-kit-demo__row">
          <Checkbox checked={a} onChange={setA} label="选项" />
          <Checkbox checked={b} onChange={setB} label="选项" />
        </div>
      </DemoVariant>
      <DemoVariant label="禁用">
        <div class="ui-kit-demo__row">
          <Checkbox checked={false} onChange={() => {}} disabled label="未勾选" />
          <Checkbox checked onChange={() => {}} disabled label="已勾选" />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
