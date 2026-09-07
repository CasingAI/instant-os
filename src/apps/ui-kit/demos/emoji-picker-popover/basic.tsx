import { useState } from 'preact/hooks'
import { EmojiPickerPopover } from '../../../../ui/emoji-picker-popover.tsx'
import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function EmojiPickerPopoverDemo() {
  const [emoji, setEmoji] = useState('🐱')
  const [custom, setCustom] = useState('🚀')

  return (
    <DemoVariants>
      <DemoVariant label="默认触发器">
        <EmojiPickerPopover value={emoji} onChange={setEmoji} triggerLabel="选择图标">
          <Button>
            <span aria-hidden="true">{emoji}</span>
            选择图标
          </Button>
        </EmojiPickerPopover>
      </DemoVariant>
      <DemoVariant label="自定义触发器内容">
        <EmojiPickerPopover value={custom} onChange={setCustom}>
          <Button>
            <span aria-hidden="true">{custom}</span>
            更换表情
          </Button>
        </EmojiPickerPopover>
      </DemoVariant>
    </DemoVariants>
  )
}
