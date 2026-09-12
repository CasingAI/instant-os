import { Progress } from '../../../../ui/progress.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ProgressBasicDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="百分比" wide>
        <div class="ui-kit-demo__stack">
          <Progress percent={0} ariaLabel="空" />
          <Progress percent={32} ariaLabel="三成" />
          <Progress percent={70} ariaLabel="七成" />
          <Progress percent={100} ariaLabel="满" />
        </div>
      </DemoVariant>

      <DemoVariant label="小尺寸" wide>
        <Progress percent={48} size="small" ariaLabel="小尺寸" />
      </DemoVariant>

      <DemoVariant label="自定义读数" wide>
        <Progress percent={12 / 340 * 100} info="12 / 340" ariaLabel="已下载 12 共 340" />
      </DemoVariant>

      <DemoVariant label="隐藏读数" wide>
        <Progress percent={64} showInfo={false} ariaLabel="无读数" />
      </DemoVariant>
    </DemoVariants>
  )
}
