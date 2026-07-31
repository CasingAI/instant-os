/**
 * 拟物化金属罗盘 —— 网页浏览器的统一品牌符号。
 * 起始页 logo 与全局应用图标（BrowserIcon）共用本组件，确保两者永远一致。
 *
 * 用法：<CompassMark />（默认铺满父容器，1em × 1em）。
 */
export function CompassMark() {
  return (
    <svg
      viewBox="0 0 80 80"
      width="1em"
      height="1em"
      style={{ display: 'block', width: '100%', height: '100%' }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="safari-compass-bezel" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#f4f4f4" />
          <stop offset="55%" stopColor="#c6c6c6" />
          <stop offset="100%" stopColor="#8e8e8e" />
        </radialGradient>
        <radialGradient id="safari-compass-face" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#eaeaea" />
          <stop offset="100%" stopColor="#cfcfcf" />
        </radialGradient>
        <linearGradient id="safari-compass-needle-n" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff6b61" />
          <stop offset="50%" stopColor="#ff3b30" />
          <stop offset="100%" stopColor="#c9261d" />
        </linearGradient>
        <linearGradient id="safari-compass-needle-s" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a5a5c" />
          <stop offset="100%" stopColor="#2a2a2c" />
        </linearGradient>
        <radialGradient id="safari-compass-hub" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#d8d8d8" />
          <stop offset="60%" stopColor="#9a9a9a" />
          <stop offset="100%" stopColor="#6a6a6a" />
        </radialGradient>
      </defs>

      {/* 外金属圈 + 立体边缘 */}
      <circle cx="40" cy="40" r="38" fill="url(#safari-compass-bezel)" />
      <circle cx="40" cy="40" r="38" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1" />
      <circle cx="40" cy="40" r="37" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1" opacity="0.7" />

      {/* 表盘内陷 */}
      <circle cx="40" cy="40" r="31" fill="url(#safari-compass-face)" />
      <circle cx="40" cy="40" r="31" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="0.75" />
      <circle cx="40" cy="40" r="30" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="0.5" />

      {/* 方位刻度环 */}
      <circle cx="40" cy="40" r="24" fill="none" stroke="rgba(0,0,0,0.14)" stroke-width="0.75" />
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i * 30 * Math.PI) / 180
        const r1 = i % 3 === 0 ? 26 : 28
        const r2 = 30
        return (
          <line
            key={i}
            x1={40 + r1 * Math.sin(a)}
            y1={40 - r1 * Math.cos(a)}
            x2={40 + r2 * Math.sin(a)}
            y2={40 - r2 * Math.cos(a)}
            stroke="rgba(0,0,0,0.45)"
            strokeWidth={i % 3 === 0 ? 1.1 : 0.6}
          />
        )
      })}

      {/* 指针（红 N + 灰 S，带中线高光）—— 位于刻度之上 */}
      <path d="M40 20 L44.5 40 L40 37 L35.5 40 Z" fill="url(#safari-compass-needle-n)" stroke="#9c1c14" strokeWidth="0.4" />
      <path d="M40 60 L44.5 40 L40 43 L35.5 40 Z" fill="url(#safari-compass-needle-s)" stroke="#1c1c1e" strokeWidth="0.4" />

      {/* N 标徽 —— 不透明圆底，置于指针之上，确保透过徽章看不到指针/刻度 */}
      <circle cx="40" cy="13" r="6.5" fill="#fff" stroke="rgba(0,0,0,0.25)" stroke-width="0.6" />
      <text x="40" y="16" text-anchor="middle" fill="#ff3b30" font-size="8" font-weight="700">
        N
      </text>

      {/* 中心凸起轴 */}
      <circle cx="40" cy="40" r="3.4" fill="url(#safari-compass-hub)" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" />
      <circle cx="39" cy="39" r="1" fill="rgba(255,255,255,0.85)" />
    </svg>
  )
}
