import { useRef, useState } from 'preact/hooks'
import { Button } from '../../../../ui/button.tsx'
import { Icon } from '../../../../ui/icon.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ButtonBasicDemo() {
  const [saving, setSaving] = useState(false)
  const [hexagons, setHexagons] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const save = () => {
    window.clearTimeout(timer.current)
    setSaving(true)
    timer.current = window.setTimeout(() => setSaving(false), 2000)
  }

  return (
    <DemoVariants>
      <DemoVariant label="色调" wide>
        <div class="ui-kit-demo__row">
          <Button>次要</Button>
          <Button tone="primary">主要</Button>
          <Button tone="danger">危险</Button>
        </div>
      </DemoVariant>
      <DemoVariant label="borderless · 纯文字 / 图标（切背景看 darkMode，按住看光晕）" wide textured={!hexagons} hexagons={hexagons}>
        <div class="ui-kit-demo__row">
          <Button variant="borderless" darkMode={!hexagons}>按钮</Button>
          <Button variant="borderless" darkMode={!hexagons} icon={<Icon name="arrow_back" />} title="后退" />
          <Button variant="borderless" darkMode={!hexagons} disabled>禁用</Button>
          <Button variant="borderless" darkMode={!hexagons} onClick={() => setHexagons(!hexagons)}>切换背景</Button>
        </div>
      </DemoVariant>
      <DemoVariant label="图标 / icon+文字">
        <div class="ui-kit-demo__row">
          <Button icon={<Icon name="arrow_back" />} title="后退" />
          <Button icon={<Icon name="arrow_forward" />} title="前进" />
          {/* showBothIconAndText 是受控例外：仅演示能力，实际页面未经用户要求不得使用 */}
          <Button icon={<Icon name="add" />} showBothIconAndText>新建</Button>
          <Button disabled>
            禁用
          </Button>
        </div>
      </DemoVariant>
      <DemoVariant label="busy 加载态">
        <div class="ui-kit-demo__row">
          <Button busy>保存中</Button>
          <Button onClick={save} busy={saving}>
            保存
          </Button>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
