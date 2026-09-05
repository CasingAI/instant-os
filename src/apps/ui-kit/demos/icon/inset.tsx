import { useState } from 'preact/hooks'
import { Icon } from '../../../../ui/icon.tsx'
import { IosRangeSlider } from '../../../../ui/ios-range-slider.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

/** 内凹演示用的图标名，三个画法共用同一排便于对照 */
const INSET_ICON_NAMES = ['home', 'favorite', 'star', 'delete', 'settings', 'lock']

const INSET_FILTER_ID = 'ui-kit-icon-inset'

/**
 * Icon 内凹效果演示：CSS 没有原生文字内阴影（text-shadow 只有外阴影，box-shadow inset 只作用于盒子），
 * 本卡对比两种画法——SVG 滤镜在字形 alpha 上挖顶/底缘月牙环填色叠回，是真·内阴影；
 * background-clip: text 塞渐变只是明暗模拟。深度/浓度/字重滑杆联动全部变体。
 */
export default function IconInsetDemo() {
  const [depth, setDepth] = useState(1.25)
  const [strength, setStrength] = useState(0.45)
  const [weight, setWeight] = useState(400)
  // 渐变画法的暗端随浓度加深、随深度拉长，与滤镜画法共用同一组手感参数
  const simStyle: preact.JSX.CSSProperties = {
    background: `linear-gradient(180deg, rgba(0, 0, 0, ${(strength + 0.2).toFixed(2)}) 0%, rgba(0, 0, 0, ${(
      strength * 0.5 + 0.08
    ).toFixed(2)}) ${(45 - depth * 6).toFixed(0)}%, rgba(255, 255, 255, ${Math.min(1, strength * 1.5).toFixed(
      2,
    )}) 100%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  }
  // 示例区是横向 flex，必须像 IconComboDemo 一样收成单一纵向根
  return (
    <div class="ui-kit-demo__icon-panel">
      <svg class="ui-kit-demo__inset-defs" aria-hidden="true">
        <filter
          id={INSET_FILTER_ID}
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
          color-interpolation-filters="sRGB"
        >
          {/* 顶缘内阴影：字形副本向下错位模糊后盖不住的顶缘月牙挖出来填深色 */}
          <feOffset in="SourceAlpha" dx="0" dy={depth} result="inset-off-down" />
          <feGaussianBlur in="inset-off-down" stdDeviation={depth * 0.6} result="inset-blur-down" />
          <feComposite in="SourceAlpha" in2="inset-blur-down" operator="out" result="inset-ring-down" />
          <feFlood flood-color="#000000" flood-opacity={strength} result="inset-color-down" />
          <feComposite in="inset-color-down" in2="inset-ring-down" operator="in" result="inset-shadow" />
          {/* 底缘内高光：副本向上错位，底缘月牙填亮色 */}
          <feOffset in="SourceAlpha" dx="0" dy={-depth * 0.7} result="inset-off-up" />
          <feGaussianBlur in="inset-off-up" stdDeviation={depth * 0.4} result="inset-blur-up" />
          <feComposite in="SourceAlpha" in2="inset-blur-up" operator="out" result="inset-ring-up" />
          <feFlood
            flood-color="#ffffff"
            flood-opacity={Math.min(1, strength * 1.7)}
            result="inset-color-up"
          />
          <feComposite in="inset-color-up" in2="inset-ring-up" operator="in" result="inset-light" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="inset-light" />
            <feMergeNode in="inset-shadow" />
          </feMerge>
        </filter>
      </svg>
      <div class="ui-kit-demo__inset-controls" style={{ flex: '0 0 auto' }}>
        <label class="ui-kit-demo__inset-control">
          <span class="ui-kit-demo__label">深度</span>
          <IosRangeSlider value={depth} min={0.5} max={3} step={0.25} onChange={setDepth} />
        </label>
        <label class="ui-kit-demo__inset-control">
          <span class="ui-kit-demo__label">浓度</span>
          <IosRangeSlider value={strength} min={0.15} max={0.8} step={0.05} onChange={setStrength} />
        </label>
        <label class="ui-kit-demo__inset-control">
          <span class="ui-kit-demo__label">字重</span>
          <IosRangeSlider value={weight} min={100} max={700} step={100} onChange={setWeight} />
        </label>
      </div>
      <DemoVariants>
        <DemoVariant label="SVG 滤镜 · 真·内阴影">
          <div class="ui-kit-demo__inset-row">
            {INSET_ICON_NAMES.map((name) => (
              <div key={name} class="ui-kit-demo__inset-plate" title={name}>
                <Icon name={name} size={26} weight={weight} style={{ filter: `url(#${INSET_FILTER_ID})` }} />
              </div>
            ))}
          </div>
          <span class="ui-kit-demo__hint">
            字形 alpha 副本错位+模糊后与原字形相减，挖出顶缘月牙填深色、底缘月牙填亮色叠回——偏移和模糊可调，凹坑感来自投影落在坑壁
          </span>
        </DemoVariant>
        <DemoVariant label="background-clip: text 渐变 · 明暗模拟">
          <div class="ui-kit-demo__inset-row">
            {INSET_ICON_NAMES.map((name) => (
              <div key={name} class="ui-kit-demo__inset-plate" title={name}>
                <Icon name={name} size={26} weight={weight} style={simStyle} />
              </div>
            ))}
          </div>
          <span class="ui-kit-demo__hint">
            渐变透过字形上暗下亮，凑近看没有「投影落在坑壁」的立体感，但零滤镜开销
          </span>
        </DemoVariant>
        <DemoVariant label="深色键帽 · 同一滤镜直接复用">
          <div class="ui-kit-demo__inset-row">
            {INSET_ICON_NAMES.map((name) => (
              <div key={name} class="ui-kit-demo__inset-plate ui-kit-demo__inset-plate--dark" title={name}>
                <Icon name={name} size={26} weight={weight} style={{ filter: `url(#${INSET_FILTER_ID})` }} />
              </div>
            ))}
          </div>
          <span class="ui-kit-demo__hint">滤镜作用于渲染后的字形 alpha，换底色只需改容器文字色</span>
        </DemoVariant>
      </DemoVariants>
    </div>
  )
}
