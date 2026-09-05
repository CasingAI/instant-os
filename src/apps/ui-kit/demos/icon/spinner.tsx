import { useRef, useState } from 'preact/hooks'
import { Icon } from '../../../../ui/icon.tsx'
import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function IconSpinnerDemo() {
  const [loading, setLoading] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const reload = () => {
    window.clearTimeout(timer.current)
    setLoading(true)
    timer.current = window.setTimeout(() => setLoading(false), 2000)
  }

  return (
    <DemoVariants>
      <DemoVariant label="尺寸随 size（颜色随文字色）">
        <div class="ui-kit-demo__row">
          <Icon name="activity-indicator" size={16} label="加载中" />
          <Icon name="activity-indicator" size={24} label="加载中" />
          <Icon name="activity-indicator" size={37} label="加载中" />
          <span style="color: #b3541e;">
            <Icon name="activity-indicator" size={24} label="加载中" />
          </span>
        </div>
      </DemoVariant>
      <DemoVariant label="与文字并排">
        <div class="ui-kit-demo__row">
          {loading ? (
            <span class="ui-kit-demo__row" style="gap: 6px;">
              <Icon name="activity-indicator" size={16} label="正在加载" />
              正在加载…
            </span>
          ) : (
            <span>加载完成</span>
          )}
          <Button onClick={reload} busy={loading}>
            重新加载
          </Button>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
