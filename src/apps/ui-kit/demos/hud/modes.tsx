import { useEffect, useRef, useState } from 'preact/hooks'
import { useHud, type HudMode } from '../../../../ui/hud.tsx'
import { Button } from '../../../../ui/button.tsx'
import { IosRangeSlider } from '../../../../ui/ios-range-slider.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

const PREVIEW_MS = 1200

const PREVIEWS: { mode: HudMode; text: string }[] = [
  { mode: 'spinner', text: '正在加载…' },
  { mode: 'text', text: '已连上服务器' },
  { mode: 'success', text: '已复制' },
  { mode: 'error', text: '同步失败' },
]

export default function HudModesDemo() {
  const hud = useHud()
  const timerRef = useRef<number | undefined>(undefined)
  const [percent, setPercent] = useState(64)
  const [barOpen, setBarOpen] = useState(false)

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const preview = (mode: HudMode, text: string) => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    hud.show({ mode, text })
    timerRef.current = window.setTimeout(() => hud.hide(), PREVIEW_MS)
  }

  // 开着时每次 percent 变化重新 show 即原地替换内容；关了 hide 收起
  useEffect(() => {
    if (barOpen) {
      hud.show({ mode: 'progress', percent, text: '正在下载', detail: 'setup.dmg' })
    } else {
      hud.hide()
    }
    // hud.show/hide 稳定；percent 变化即原地替换内容
  }, [barOpen, percent])

  return (
    <>
      {hud.view}
      <DemoVariants>
        <DemoVariant label="四种形态（各弹 1.2 秒自动收）">
          <div class="ui-kit-demo__row">
            {PREVIEWS.map(({ mode, text }) => (
              <Button key={mode} onClick={() => preview(mode, text)}>
                {text}
              </Button>
            ))}
          </div>
        </DemoVariant>
        <DemoVariant label="横条进度">
          <div class="ui-kit-demo__row">
            <Button tone={barOpen ? 'danger' : 'primary'} onClick={() => setBarOpen(!barOpen)}>
              {barOpen ? '收起进度 HUD' : '打开进度 HUD'}
            </Button>
            <IosRangeSlider value={percent} min={0} max={100} step={1} onChange={setPercent} label="进度" />
          </div>
        </DemoVariant>
      </DemoVariants>
    </>
  )
}
