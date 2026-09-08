import { useRef, useState } from 'preact/hooks'
import { Button } from '../../ui/button.tsx'
import { Switch } from '../../ui/switch.tsx'
import { creaseFromFinger } from './page-curl-geometry.ts'
import {
  DEFAULT_PAGE_CURL_SHADOWS,
  togglePageCurlShadow,
  type PageCurlShadowKey,
  type PageCurlShadowOptions,
} from './page-curl-shadow-options.ts'
import { PageCurlVariantWebgl } from './page-curl-variant-webgl.tsx'
import { useCurlGesture, type CurlVariantProps } from './use-curl-gesture.ts'
import './page-curl-demo.css'

// iOS 6 地图右下角卷页（page curl）WebGL 演示。
// 舞台分层：设置页（底层）→ 投影 → 地图页 → 折角热区。
// 手势由 useCurlGesture 提供：手指捏住纸角，折痕随手指转向、纸角钉在指尖。

/** 两端静止阈值：p 低于/高于它视为停在开/合端点，折角贴纸重新亮出 */
const REST_NEAR = 0.02
const REST_FAR = 0.98

const SHADOW_ITEMS: { key: PageCurlShadowKey; label: string }[] = [
  { key: 'underlay', label: '设置页投影' },
  { key: 'edge', label: '纸边阴影' },
  { key: 'front', label: '卷筒正面暗部' },
  { key: 'back', label: '纸背曲面暗部' },
]

const VIEW_TOGGLE_ITEMS = [
  { id: 'standard', label: '标准' },
  { id: 'hybrid', label: '混合' },
  { id: 'satellite', label: '卫星' },
] as const

function SettingsUnderlay() {
  const [view, setView] = useState<'standard' | 'hybrid' | 'satellite'>('standard')
  return (
    <div class="page-curl__underlay">
      <div class="page-curl__underlay-links">
        <span class="page-curl__underlay-link">地图提供方</span>
        <span class="page-curl__underlay-link">报告问题</span>
      </div>
      <div class="page-curl__viewtoggle" role="group" aria-label="地图视图">
        {VIEW_TOGGLE_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            class={`page-curl__viewtoggle-btn${view === item.id ? ' page-curl__viewtoggle-btn--active' : ''}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <ul class="page-curl__underlay-rows">
        <li>
          <span>放置图钉</span>
          <span class="page-curl__underlay-more">›</span>
        </li>
        <li>
          <span>打印地图</span>
          <span class="page-curl__underlay-more">›</span>
        </li>
        <li>
          <span>显示路况</span>
          <span class="page-curl__underlay-more">›</span>
        </li>
      </ul>
    </div>
  )
}

export function PageCurlDemo() {
  const stageRef = useRef<HTMLDivElement>(null)
  const { p, finger, size, cornerOnPointerDown, toggle, autoPlay } = useCurlGesture(stageRef)
  const [shadows, setShadows] = useState<PageCurlShadowOptions>(DEFAULT_PAGE_CURL_SHADOWS)
  const variantProps: CurlVariantProps = { p, finger, size }

  // 投影贴在设置页上、地图页下面；方向和位置跟随 WebGL 折痕变化。
  const resting = p < REST_NEAR || p > REST_FAR
  let shadowBackground = 'none'
  if (size.w > 0 && size.h > 0) {
    const crease = creaseFromFinger(finger ?? { x: size.w, y: size.h }, size.w, size.h)
    const angle = (Math.atan2(crease.nx, -crease.ny) * 180) / Math.PI
    const rad = (angle * Math.PI) / 180
    const lineLen = Math.abs(size.w * Math.sin(rad)) + Math.abs(size.h * Math.cos(rad))
    const atCrease =
      (crease.kx - size.w / 2) * crease.nx +
      (crease.ky - size.h / 2) * crease.ny +
      lineLen / 2 +
      crease.radius
    const shadowWidth = Math.min(96, Math.max(6, crease.radius * 1.2))
    shadowBackground = `linear-gradient(${angle.toFixed(2)}deg, rgba(0,0,0,0) ${(atCrease - shadowWidth * 0.25).toFixed(2)}px, rgba(0,0,0,0.24) ${atCrease.toFixed(2)}px, rgba(0,0,0,0.12) ${(atCrease + shadowWidth * 0.3).toFixed(2)}px, rgba(0,0,0,0.035) ${(atCrease + shadowWidth * 0.65).toFixed(2)}px, rgba(0,0,0,0) ${(atCrease + shadowWidth).toFixed(2)}px)`
  }

  const setShadow = (key: PageCurlShadowKey, checked: boolean) => {
    setShadows((current) => togglePageCurlShadow(current, key, checked))
  }

  return (
    <div class="page-curl">
      <div class="page-curl__toolbar">
        <div class="page-curl__shadow-switches" role="group" aria-label="阴影开关">
          {SHADOW_ITEMS.map(({ key, label }) => (
            <div class="page-curl__shadow-switch" key={key}>
              <span>{label}</span>
              <Switch
                checked={shadows[key]}
                onChange={(checked) => setShadow(key, checked)}
                label={label}
              />
            </div>
          ))}
        </div>
        <Button onClick={autoPlay}>自动演示</Button>
      </div>
      <div class="page-curl__stage" ref={stageRef}>
        <SettingsUnderlay />
        <div
          class="page-curl__shadow"
          aria-hidden="true"
          style={{
            opacity: shadows.underlay && !resting ? 1 : 0,
            background: shadowBackground,
          }}
        />
        <PageCurlVariantWebgl {...variantProps} shadows={shadows} />
        {/* 热区永远可交互（弹簧途中也能抓住），只让贴纸在两端静止时现身；
            卷动中贴纸淡出让位给真几何，但 pointer-events 不关。 */}
        <div
          class={`page-curl__hit${resting ? ' page-curl__hit--resting' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={p > 0.5 ? '卷回地图页' : '卷开地图页'}
          onPointerDown={cornerOnPointerDown}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggle()
            }
          }}
        />
      </div>
      <p class="page-curl__note">
        <span class="page-curl__note-hint">
          拖住右下角跟手卷页；点击折角或聚焦后按 Enter/空格在开合间切换。关闭开关即可单独观察每一重阴影。
        </span>
        WebGL 连续卷曲：纸角跟随手指，整片纸背翻回地图上方，边缘连续弯曲；纸背保留很淡的反向地图内容。
      </p>
    </div>
  )
}
