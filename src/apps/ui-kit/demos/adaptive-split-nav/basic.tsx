import { useOs } from '../../../../os/os-context.tsx'
import { Button } from '../../../../ui/button.tsx'

export default function AdaptiveSplitNavDemo() {
  const { openApp } = useOs()
  return (
    <div class="ui-kit-demo__app-launch">
      <p class="ui-kit-demo__status">
        布局原语，需整应用承载：拖窗口边缘跨过宽度阈值形态即时跟随，松手或双击标题栏播完整滑轨形变。分栏宽度 ≤640 时左右栏固定 50/50（紧凑档），≥700 恢复 listRatio 比例。
      </p>
      <Button tone="primary" onClick={() => openApp('nav-kit-demo')}>
        打开「导航组件演示」应用
      </Button>
    </div>
  )
}
