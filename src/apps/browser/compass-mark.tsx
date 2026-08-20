import { useId } from 'preact/hooks'

function svgUid(rawId: string, suffix: string): string {
  return `compass-mark-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

type CompassMarkProps = {
  size?: number
}

/**
 * 拟物化金属罗盘 —— 网页浏览器的统一品牌符号。
 * 起始页 logo 与全局应用图标（BrowserIcon）共用本组件，确保两者永远一致。
 *
 * 指针固定偏转 48°（Safari 式），小尺寸和大尺寸是同一套构图，而不是放大后才露出细节。
 */
export function CompassMark({ size }: CompassMarkProps = {}) {
  const rawId = useId()
  const bezel = svgUid(rawId, 'bezel')
  const face = svgUid(rawId, 'face')
  const needleN = svgUid(rawId, 'needle-n')
  const needleS = svgUid(rawId, 'needle-s')
  const hub = svgUid(rawId, 'hub')
  const dim = size ?? '100%'

  return (
    <svg
      viewBox="0 0 80 80"
      width={dim}
      height={dim}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={bezel} cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#f4f4f4" />
          <stop offset="55%" stopColor="#c6c6c6" />
          <stop offset="100%" stopColor="#8e8e8e" />
        </radialGradient>
        <radialGradient id={face} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#eaeaea" />
          <stop offset="100%" stopColor="#cfcfcf" />
        </radialGradient>
        <linearGradient id={needleN} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff6b61" />
          <stop offset="50%" stopColor="#ff3b30" />
          <stop offset="100%" stopColor="#c9261d" />
        </linearGradient>
        <linearGradient id={needleS} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a5a5c" />
          <stop offset="100%" stopColor="#2a2a2c" />
        </linearGradient>
        <radialGradient id={hub} cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#d8d8d8" />
          <stop offset="60%" stopColor="#9a9a9a" />
          <stop offset="100%" stopColor="#6a6a6a" />
        </radialGradient>
      </defs>

      <circle cx="40" cy="40" r="38" fill={`url(#${bezel})`} />
      <circle cx="40" cy="40" r="38" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.2" />
      <circle cx="40" cy="40" r="37" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.2" opacity="0.7" />

      <circle cx="40" cy="40" r="31" fill={`url(#${face})`} />
      <circle cx="40" cy="40" r="31" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="0.9" />
      <circle cx="40" cy="40" r="30" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="0.6" />

      <circle cx="40" cy="40" r="24" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="1" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * 45 * Math.PI) / 180
        const major = i % 2 === 0
        const r1 = major ? 25 : 27
        const r2 = 30
        return (
          <line
            key={i}
            x1={40 + r1 * Math.sin(a)}
            y1={40 - r1 * Math.cos(a)}
            x2={40 + r2 * Math.sin(a)}
            y2={40 - r2 * Math.cos(a)}
            stroke="rgba(0,0,0,0.5)"
            strokeWidth={major ? 1.8 : 1}
          />
        )
      })}

      <g transform="rotate(48 40 40)">
        <path
          d="M40 16 L46.2 40 L40 36 L33.8 40 Z"
          fill={`url(#${needleN})`}
          stroke="#9c1c14"
          strokeWidth="0.5"
        />
        <path
          d="M40 64 L46.2 40 L40 44 L33.8 40 Z"
          fill={`url(#${needleS})`}
          stroke="#1c1c1e"
          strokeWidth="0.5"
        />
      </g>

      <circle cx="40" cy="13" r="7.2" fill="#fff" stroke="rgba(0,0,0,0.25)" stroke-width="0.7" />
      <text x="40" y="16.6" text-anchor="middle" fill="#ff3b30" font-size="9" font-weight="700">
        N
      </text>

      <circle cx="40" cy="40" r="3.8" fill={`url(#${hub})`} stroke="rgba(0,0,0,0.4)" strokeWidth="0.6" />
      <circle cx="38.8" cy="38.8" r="1.1" fill="rgba(255,255,255,0.85)" />
    </svg>
  )
}
