import { useEffect, useRef, useState } from 'preact/hooks'
import { useHud, type HudMode } from '../../../../ui/hud.tsx'
import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

const PREVIEW_MS = 1200
const DOWNLOAD_TICK_MS = 160

const PREVIEWS: { mode: HudMode; text: string }[] = [
  { mode: 'spinner', text: '正在加载…' },
  { mode: 'text', text: '已连上服务器' },
  { mode: 'success', text: '已复制' },
  { mode: 'error', text: '同步失败' },
]

export default function HudModesDemo() {
  const hud = useHud()
  const timerRef = useRef<number | undefined>(undefined)
  const [percent, setPercent] = useState(0)
  const [downloading, setDownloading] = useState(false)

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

  // 进度 HUD 盖住全窗、底层点不动，收不了靠再点按钮——自己跑到 100% 停半秒后 hide；
  // 途中每次进度变化重新 show 即原地替换内容不闪断
  useEffect(() => {
    if (!downloading) return
    hud.show({ mode: 'progress', percent, text: '正在下载', detail: 'setup.dmg' })
    if (percent >= 100) {
      const done = window.setTimeout(() => {
        setDownloading(false)
        hud.hide()
      }, 500)
      return () => window.clearTimeout(done)
    }
    const tick = window.setTimeout(() => {
      setPercent((p) => Math.min(100, p + 3 + Math.floor(Math.random() * 8)))
    }, DOWNLOAD_TICK_MS)
    return () => window.clearTimeout(tick)
    // hud.show/hide 稳定
  }, [downloading, percent])

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
        <DemoVariant label="横条进度（跑到 100% 自动收）">
          <div class="ui-kit-demo__row">
            <Button tone="primary" onClick={() => { setPercent(0); setDownloading(true) }}>
              模拟下载
            </Button>
          </div>
        </DemoVariant>
      </DemoVariants>
    </>
  )
}
