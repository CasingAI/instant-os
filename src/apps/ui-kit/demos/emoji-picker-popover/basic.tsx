import { useState } from 'preact/hooks'
import { EmojiPickerPopover } from '../../../../ui/emoji-picker-popover.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function EmojiPickerPopoverDemo() {
  const [emoji, setEmoji] = useState('🐱')
  const [custom, setCustom] = useState('🚀')

  return (
    <DemoVariants>
      <DemoVariant label="默认触发器">
        <EmojiPickerPopover value={emoji} onChange={setEmoji} triggerLabel="选择图标" />
      </DemoVariant>
      <DemoVariant label="自定义触发器内容">
        <EmojiPickerPopover value={custom} onChange={setCustom}>
          <span class="ui-kit-demo__emoji-trigger">
            <span aria-hidden="true">{custom}</span>
            更换表情
          </span>
        </EmojiPickerPopover>
      </DemoVariant>
    </DemoVariants>
  )
}
