import { HelpHint } from '../../../../ui/help-hint.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function HelpHintDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="行内提示">
        <div class="ui-kit-demo__row ui-kit-demo__row--labeled">
          <span class="ui-kit-demo__hint">机会压缩</span>
          <HelpHint
            text="开启后尽量以稀疏分块存储：缺席的全零块不落库，写入全零自动打洞"
            label="机会压缩说明"
          />
        </div>
      </DemoVariant>
      <DemoVariant label="长文案（视口边缘自动翻转 / 夹紧）">
        <HelpHint text="这是一段较长的说明文字，用于验证气泡在窗口边缘的定位：靠近视口底部时自动向上弹出，宽度超出视口时自动收窄夹紧。" />
      </DemoVariant>
    </DemoVariants>
  )
}
