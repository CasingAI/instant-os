import { useRef, useState } from 'preact/hooks'
import { Button } from '../../ui/button.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { creaseFromFinger } from './page-curl-geometry.ts'
import { PageCurlVariantClip2d } from './page-curl-variant-clip2d.tsx'
import { PageCurlVariantCss3d } from './page-curl-variant-css3d.tsx'
import { PageCurlVariantWebgl } from './page-curl-variant-webgl.tsx'
import { useCurlGesture, type CurlVariantProps } from './use-curl-gesture.ts'
import './page-curl-demo.css'

// iOS 6 地图右下角卷页（page curl）三方案对比演示。
// 舞台分层：设置页（底层）→ 投影 → 地图页（当前方案）→ 折角热区。
// 手势由 useCurlGesture 统一提供：手指捏住纸角（二维点 finger），标量 p 是它
// 的对角投影——CSS 两案吃 p（折线恒为对角线），WebGL 案吃 finger（折痕随手指
// 转向、纸角钉在指尖）；三种方案卷满（p=1）时设置页都完全揭示。

export type PageCurlVariantId = 'css3d' | 'clip2d' | 'webgl'

/** 两端静止阈值：p 低于/高于它视为停在开/合端点，折角贴纸重新亮出 */
const REST_NEAR = 0.02
const REST_FAR = 0.98

const VARIANT_ITEMS: { id: PageCurlVariantId; label: string }[] = [
  { id: 'css3d', label: 'CSS 3D 折叠' },
  { id: 'clip2d', label: '2D 镜像' },
  { id: 'webgl', label: 'WebGL 卷曲' },
]

const VARIANT_NOTES: Record<PageCurlVariantId, string> = {
  css3d:
    '方案一 · 纯 CSS 3D 折叠：页面副本按折线裁开，rotate3d 绕对角折线（轴向量 (1,-1,0)）正向旋转 0→180°，翻过 90° 由预旋转 180° 的镜像裁剪纸背接棒；每帧只写 transform / clip-path，全走合成器，成本最低。观感是"硬折角"而非连续卷曲——接近系统 UIModalTransitionStylePartialCurl 的档位。',
  clip2d:
    '方案二 · 纯 2D 裁剪压缩：绕折线折 θ 角的正交投影就是单一的 cos θ 压缩矩阵，折线上的点全程不动（天然铰链），90° 后纸面翻扣到折线另一侧，渐变假光照 + 投影。零 3D、零 WebGL，PaperFold for iOS 2012 年在同代硬件上验证过的路数（截屏一次 + 变换 + 假光照）。',
  webgl:
    '方案三 · WebGL 连续卷曲：一张地图纹理 + 64×24 网格，手指直接捏住纸角——折痕垂直于「纸角↔手指」连线、随拖动转向，卷径随距离伸缩，纸角绕半圈圆柱后恰好钉在指尖。每帧更新铰点/法向/半径三个 uniform，深度按卷角排序：柱面近侧遮住远侧、翻扣的纸背压住留平纸面，最接近 iOS 6 原版 OpenGL 实现的观感。',
}

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

export function PageCurlDemo({ initialVariant }: { initialVariant?: PageCurlVariantId }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const { p, finger, size, cornerOnPointerDown, toggle, autoPlay } = useCurlGesture(stageRef)
  const [variant, setVariant] = useState<PageCurlVariantId>(initialVariant ?? 'css3d')
  const variantProps: CurlVariantProps = { p, finger, size }

  // 投影画在设置页上、地图页下面：明暗带贴着折线，只在卷动过程中可见。
  // CSS 两案折线恒为对角线 x+y=s，135° 渐变的 stop 位置恰为 (x+y)/√2（沿渐变线
  // 的距离）；WebGL 案折痕随手指转向，渐变方向改按折痕法向 n 现算，最暗点钉在
  // 铰点 K 的投影上。可见的只有折线外侧（揭示侧），最暗点钉在折痕、向外 90px
  // 渐透——最后 stop 之后颜色无限延伸，不补透明 stop 会罩住整页。
  const resting = p < REST_NEAR || p > REST_FAR
  let shadowBackground: string
  if (variant === 'webgl' && size.w > 0 && size.h > 0) {
    const crease = creaseFromFinger(finger ?? { x: size.w, y: size.h }, size.w, size.h)
    // CSS 渐变角：0deg 朝上、顺时针，方向向量 (sin θ, −cos θ) 要对准法向 n
    const angle = (Math.atan2(crease.nx, -crease.ny) * 180) / Math.PI
    const rad = (angle * Math.PI) / 180
    const lineLen = Math.abs(size.w * Math.sin(rad)) + Math.abs(size.h * Math.cos(rad))
    // 渐变线过盒子中心，stop 从线起点计距：铰点投影 = dot(K−center, n) + Lg/2
    const atCrease =
      (crease.kx - size.w / 2) * crease.nx +
      (crease.ky - size.h / 2) * crease.ny +
      lineLen / 2
    shadowBackground = `linear-gradient(${angle.toFixed(2)}deg, rgba(0,0,0,0) ${(atCrease - 24).toFixed(2)}px, rgba(0,0,0,0.30) ${atCrease.toFixed(2)}px, rgba(0,0,0,0) ${(atCrease + 90).toFixed(2)}px)`
  } else {
    const s = (1 - p) * (size.w + size.h)
    const crease = s / Math.SQRT2
    shadowBackground = `linear-gradient(135deg, rgba(0,0,0,0) ${crease - 24}px, rgba(0,0,0,0.30) ${crease}px, rgba(0,0,0,0) ${crease + 90}px)`
  }

  return (
    <div class="page-curl">
      <div class="page-curl__toolbar">
        <SegmentedControl
          value={variant}
          items={VARIANT_ITEMS}
          onChange={(id) => setVariant(id)}
          ariaLabel="卷页实现方案"
        />
        <Button onClick={autoPlay}>自动演示</Button>
      </div>
      <div class="page-curl__stage" ref={stageRef}>
        <SettingsUnderlay />
        <div
          class="page-curl__shadow"
          aria-hidden="true"
          style={{
            opacity: resting ? 0 : 1,
            background: shadowBackground,
          }}
        />
        {variant === 'css3d' && <PageCurlVariantCss3d {...variantProps} />}
        {variant === 'clip2d' && <PageCurlVariantClip2d {...variantProps} />}
        {variant === 'webgl' && <PageCurlVariantWebgl {...variantProps} />}
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
          拖住右下角跟手卷页；点击折角或聚焦后按 Enter/空格在开合间切换。三种方案卷满后设置页都完全揭示。
        </span>
        {VARIANT_NOTES[variant]}
      </p>
    </div>
  )
}
