import { useEffect, useRef } from 'preact/hooks'
import { useHud } from '../../../../ui/hud.tsx'
import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

const SAVING_MS = 2000
const DONE_MS = 800

export default function HudBasicDemo() {
  const hud = useHud()
  const timersRef = useRef<number[]>([])

  useEffect(
    () => () => {
      timersRef.current.forEach((id) => window.clearTimeout(id))
    },
    [],
  )

  const save = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id))
    timersRef.current = []
    hud.show('保存中…')
    timersRef.current.push(
      window.setTimeout(() => {
        hud.show({ mode: 'success', text: '已保存', minVisibleMs: 600 })
      }, SAVING_MS),
    )
    timersRef.current.push(
      window.setTimeout(() => {
        hud.hide()
      }, SAVING_MS + DONE_MS),
    )
  }

  return (
    <>
      {hud.view}
      <DemoVariants>
        <DemoVariant label="模拟保存">
          <div class="ui-kit-demo__row">
            <Button tone="primary" onClick={save}>
              保存
            </Button>
            <span>转圈 2 秒 → 对勾 0.8 秒自动收；期间本窗口点不动</span>
          </div>
        </DemoVariant>
      </DemoVariants>
    </>
  )
}
