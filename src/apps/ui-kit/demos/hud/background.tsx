import { useEffect, useRef, useState } from 'preact/hooks'
import { useHud } from '../../../../ui/hud.tsx'
import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

const TASK_MS = 3000
const DONE_VISIBLE_MS = 1800

export default function HudBackgroundDemo() {
  const hud = useHud()
  const timerRef = useRef<number | undefined>(undefined)
  const [running, setRunning] = useState(false)

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const run = () => {
    setRunning(true)
    // 故意不在点按钮的当下弹：任务跑完才 show，验证无论当时焦点在哪都弹在本窗口
    timerRef.current = window.setTimeout(() => {
      setRunning(false)
      hud.show({ mode: 'success', text: '后台任务完成', minVisibleMs: 800 })
      timerRef.current = window.setTimeout(() => hud.hide(), DONE_VISIBLE_MS)
    }, TASK_MS)
  }

  return (
    <>
      {hud.view}
      <DemoVariants>
        <DemoVariant label="后台任务完成">
          <div class="ui-kit-demo__row">
            <Button tone="primary" disabled={running} onClick={run}>
              {running ? '任务运行中…（3 秒）' : '开跑后台任务'}
            </Button>
            <span>任务跑完才弹 HUD：期间随便点了哪里，它都弹在本窗口</span>
          </div>
        </DemoVariant>
      </DemoVariants>
    </>
  )
}
