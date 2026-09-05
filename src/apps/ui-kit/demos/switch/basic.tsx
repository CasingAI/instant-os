import { useState } from 'preact/hooks'
import { Switch } from '../../../../ui/switch.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function SwitchDemo() {
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  const [c, setC] = useState(true)

  return (
    <DemoVariants>
      <DemoVariant label="开启">
        <Switch checked={a} onChange={setA} label="开启状态" />
      </DemoVariant>
      <DemoVariant label="关闭">
        <Switch checked={b} onChange={setB} label="关闭状态" />
      </DemoVariant>
      <DemoVariant label="成对对比">
        <div class="ui-kit-demo__row">
          <Switch checked={c} onChange={setC} label="A" />
          <Switch checked={!c} onChange={(next) => setC(!next)} label="B" />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
