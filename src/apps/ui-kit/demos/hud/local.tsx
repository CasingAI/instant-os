import { useEffect, useRef } from 'preact/hooks'
import { useHud } from '../../../../ui/hud.tsx'
import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

const WORK_MS = 1600

export default function HudLocalDemo() {
  const hud = useHud()
  const boxRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const run = () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    hud.show({ text: '处理中…', containerRef: boxRef })
    timerRef.current = window.setTimeout(() => hud.hide(), WORK_MS)
  }

  return (
    <>
      {hud.view}
      <DemoVariants>
        <DemoVariant label="局部遮罩">
          <div class="ui-kit-demo__row">
            <Button tone="primary" onClick={run}>
              在下方盒子内弹出 HUD
            </Button>
          </div>
          <div
            ref={boxRef}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '16px',
              border: '1px dashed #b6b6b8',
              borderRadius: '8px',
            }}
          >
            <span>盒子内容</span>
            <Button onClick={run}>盒子里的按钮（HUD 期间点不动）</Button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#666' }}>
            HUD 只盖盒子；期间盒外任何地方照常可点。
          </p>
        </DemoVariant>
      </DemoVariants>
    </>
  )
}
