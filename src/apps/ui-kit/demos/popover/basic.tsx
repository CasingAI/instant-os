import { useRef, useState } from 'preact/hooks'
import { Button } from '../../../../ui/button.tsx'
import { Popover } from '../../../../ui/popover.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function PopoverDemo() {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)

  return (
    <DemoVariants>
      <DemoVariant label="锚定气泡（箭头跟随触发器）" wide>
        <div class="ui-kit-demo__row">
          <span ref={anchorRef}>
            <Button onClick={() => setOpen(!open)}>
              {open ? '关闭气泡' : '打开气泡'}
            </Button>
          </span>
          <Popover
            open={open}
            anchorRef={anchorRef}
            onClose={() => setOpen(false)}
            ariaLabel="示例气泡"
          >
            我是带箭头的气泡：靠近视口底部自动向上翻，超出视口自动夹紧，箭头始终指向触发器。
          </Popover>
        </div>
      </DemoVariant>
      <DemoVariant label="窄窗自适应">
        <span class="ui-kit-demo__hint">把窗口拖窄到 520px 以下，上面的气泡会变成居中模态对话框</span>
      </DemoVariant>
    </DemoVariants>
  )
}
