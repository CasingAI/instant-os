import { useState } from 'preact/hooks'
import { Button } from '../../../../ui/button.tsx'
import { Icon } from '../../../../ui/icon.tsx'
import { IosRangeSlider } from '../../../../ui/ios-range-slider.tsx'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

/** 图标与 kit 组件的组合示范：Button 仅图标与 icon+文字同显（showBothIconAndText，受控例外）、List 行首图标，顶部滑杆统一调整套卡图标字重。 */
export default function IconComboDemo() {
  const [weight, setWeight] = useState(400)
  // 示例区是横向 flex，必须像 IconDemo 一样收成单一纵向根，滑杆行和变体区才不会并排
  return (
    <div class="ui-kit-demo__icon-panel">
      <div class="ui-kit-demo__icon-slider" style={{ flex: '0 0 auto' }}>
        <span class="ui-kit-demo__label">字重</span>
        <IosRangeSlider value={weight} min={100} max={700} step={100} onChange={setWeight} />
      </div>
      <DemoVariants>
        <DemoVariant label="Button · 仅图标（无文字）">
          <div class="ui-kit-demo__row">
            <Button icon={<Icon name="chevron_left" size={14} weight={weight} />} title="后退" aria-label="后退" />
            <Button icon={<Icon name="chevron_right" size={14} weight={weight} />} title="前进" aria-label="前进" />
            <Button
              tone="primary"
              icon={<Icon name="add" size={14} weight={weight} />}
              title="新建"
              aria-label="新建"
            />
            <Button
              tone="danger"
              icon={<Icon name="delete" size={13} weight={weight} />}
              title="删除"
              aria-label="删除"
            />
          </div>
        </DemoVariant>
        {/* showBothIconAndText 是受控例外：仅演示能力，实际页面未经用户要求不得使用 */}
        <DemoVariant label="Button · icon + 文字（showBothIconAndText）">
          <div class="ui-kit-demo__row">
            <Button icon={<Icon name="add" size={14} weight={weight} />} showBothIconAndText>
              新建
            </Button>
            <Button
              tone="primary"
              icon={<Icon name="cloud_download" size={14} weight={weight} />}
              showBothIconAndText
            >
              下载
            </Button>
          </div>
        </DemoVariant>
        <DemoVariant label="List · leading 槽" wide>
          <List class="ui-kit-demo__settings-group">
            <ListItem
              id="icon-combo-icloud"
              leading={<Icon name="cloud" size={17} weight={weight} />}
              label="iCloud 云盘"
              value="已开启"
              accessory="disclosure"
            />
            <ListItem
              id="icon-combo-trash"
              leading={<Icon name="delete" size={17} weight={weight} />}
              label="最近删除"
              value="3 项"
              accessory="disclosure"
            />
          </List>
        </DemoVariant>
      </DemoVariants>
    </div>
  )
}
