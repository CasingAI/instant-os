import { useEffect, useState } from 'preact/hooks'
import { Progress } from '../../../../ui/progress.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ProgressStatusDemo() {
  const [percent, setPercent] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setPercent((value) => (value >= 100 ? 0 : value + 2))
    }, 80)
    return () => window.clearInterval(id)
  }, [])

  return (
    <DemoVariants>
      <DemoVariant label="进行中 / 成功 / 失败" wide>
        <div class="ui-kit-demo__stack">
          <Progress percent={45} status="active" ariaLabel="进行中" />
          <Progress percent={100} status="success" ariaLabel="成功" />
          <Progress percent={28} status="error" ariaLabel="失败" />
        </div>
      </DemoVariant>

      <DemoVariant label="不确定态（总量未知）" wide>
        <Progress indeterminate status="active" ariaLabel="进行中，进度未知" />
      </DemoVariant>

      <DemoVariant label="循环任务" wide>
        <Progress percent={percent} status="active" ariaLabel="模拟下载" />
      </DemoVariant>
    </DemoVariants>
  )
}
