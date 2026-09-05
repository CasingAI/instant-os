import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ButtonBasicDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="色调" wide>
        <div class="ui-kit-demo__row">
          <Button>次要</Button>
          <Button tone="primary">主要</Button>
          <Button tone="danger">危险</Button>
        </div>
      </DemoVariant>
      <DemoVariant label="borderless · 纯文字 / 图标（按住看光晕）" wide textured>
        <div class="ui-kit-demo__row">
          <Button variant="borderless">按钮</Button>
          <Button variant="borderless" icon="←" title="后退" />
        </div>
      </DemoVariant>
      <DemoVariant label="图标 / icon+文字">
        <div class="ui-kit-demo__row">
          <Button icon="←" title="后退" />
          <Button icon="→" title="前进" />
          {/* showBothIconAndText 是受控例外：仅演示能力，实际页面未经用户要求不得使用 */}
          <Button icon="＋" showBothIconAndText>新建</Button>
          <Button disabled>
            禁用
          </Button>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
