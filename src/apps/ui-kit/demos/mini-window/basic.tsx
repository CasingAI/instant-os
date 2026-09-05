import { useOs } from '../../../../os/os-context.tsx'
import { Button } from '../../../../ui/button.tsx'

/** 迷你窗：打开一扇真实窗（files-op-progress 空态只有一行字），看内容撑起尺寸 */
export default function MiniWindowDemo() {
  const { openApp } = useOs()
  return (
    <div class="ui-kit-demo__app-launch">
      <p class="ui-kit-demo__status">
        点按后打开一扇真实迷你窗（进度应用空态，只有一行字）：窗口就只有一行正文加标题栏那么大；
        可拖动移动，边缘无缩放手柄，拖到屏幕边不吸附，双击标题栏不最大化。
      </p>
      <Button tone="primary" onClick={() => openApp('files-op-progress', { chromeKind: 'mini' })}>
        打开迷你窗
      </Button>
    </div>
  )
}
