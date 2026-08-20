import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `task-manager-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  let delta = a1 - a0
  while (delta <= 0) delta += 360
  const large: 0 | 1 = delta > 180 ? 1 : 0
  // SVG Y 轴向下，数学角增大在屏幕上是顺时针；sweep=1 才能绕表盘圆心。
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

const CX = 32
const CY = 32.15
const START_DEG = 135
const SWEEP_DEG = 270
const NEEDLE_T = 0.62
const BEZEL_R = 26.7
const WELL_R = 21.35
const FACE_R = 20.55
const BAND_R = 18.15
const SCREW_R = 24.15

const TICKS = Array.from({ length: 17 }, (_, i) => {
  const t = i / 16
  const deg = START_DEG + t * SWEEP_DEG
  const major = i % 4 === 0
  const [x1, y1] = polar(CX, CY, major ? 14.05 : 15.35, deg)
  const [x2, y2] = polar(CX, CY, 16.85, deg)
  return { x1, y1, x2, y2, major }
})

const SCREWS = [45, 135, 225, 315].map((deg) => {
  const [x, y] = polar(CX, CY, SCREW_R, deg)
  return { x, y, deg }
})

const GROOVE = arcPath(CX, CY, BAND_R, START_DEG, START_DEG + SWEEP_DEG)
const BANDS = [
  { d: arcPath(CX, CY, BAND_R, START_DEG, START_DEG + 0.52 * SWEEP_DEG), color: '#1db954' },
  { d: arcPath(CX, CY, BAND_R, START_DEG + 0.48 * SWEEP_DEG, START_DEG + 0.78 * SWEEP_DEG), color: '#f0c400' },
  { d: arcPath(CX, CY, BAND_R, START_DEG + 0.74 * SWEEP_DEG, START_DEG + SWEEP_DEG), color: '#e03128' },
] as const

const NEEDLE_ROT = (START_DEG + NEEDLE_T * SWEEP_DEG + 90) % 360

/**
 * iOS 6 性能监视器：带厚度的镀铬转速表，绿黄红负荷弧，指针停在偏忙区间。
 */
export function TaskManagerIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const bezelSide = svgUid(rawId, 'bezel-side')
  const bezelFace = svgUid(rawId, 'bezel-face')
  const bezelSheen = svgUid(rawId, 'bezel-sheen')
  const well = svgUid(rawId, 'well')
  const face = svgUid(rawId, 'face')
  const needleL = svgUid(rawId, 'needle-l')
  const needleR = svgUid(rawId, 'needle-r')
  const bob = svgUid(rawId, 'bob')
  const hub = svgUid(rawId, 'hub')
  const screw = svgUid(rawId, 'screw')
  const glass = svgUid(rawId, 'glass')
  const faceClip = svgUid(rawId, 'face-clip')

  return (
    <AppIconTile color="#3a414c" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-35%" y="-20%" width="170%" height="170%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="blur" />
            <feOffset dx="0.45" dy="1.55" result="off" />
            <feFlood flood-color="#12151c" flood-opacity="0.55" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={bezelSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#5a616c" />
            <stop offset="100%" stop-color="#1a1d24" />
          </linearGradient>
          <linearGradient id={bezelFace} x1="0.12" y1="0" x2="0.22" y2="1">
            <stop offset="0%" stop-color="#f7f8fb" />
            <stop offset="16%" stop-color="#d5d8e0" />
            <stop offset="38%" stop-color="#9aa0ab" />
            <stop offset="55%" stop-color="#eceef3" />
            <stop offset="78%" stop-color="#8b919c" />
            <stop offset="100%" stop-color="#4a505a" />
          </linearGradient>
          <radialGradient id={bezelSheen} cx="36%" cy="28%" r="70%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.42)" />
            <stop offset="42%" stop-color="rgba(255,255,255,0)" />
            <stop offset="100%" stop-color="rgba(0,0,0,0.18)" />
          </radialGradient>
          <radialGradient id={well} cx="50%" cy="42%" r="62%">
            <stop offset="0%" stop-color="#2a241c" />
            <stop offset="100%" stop-color="#12110e" />
          </radialGradient>
          <radialGradient id={face} cx="42%" cy="34%" r="68%">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="46%" stop-color="#f4efe4" />
            <stop offset="100%" stop-color="#d5cbb8" />
          </radialGradient>
          <linearGradient id={needleL} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#ff8a7a" />
            <stop offset="100%" stop-color="#e23a30" />
          </linearGradient>
          <linearGradient id={needleR} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#b01e18" />
            <stop offset="100%" stop-color="#6a0e0c" />
          </linearGradient>
          <radialGradient id={bob} cx="38%" cy="32%" r="65%">
            <stop offset="0%" stop-color="#d8dce4" />
            <stop offset="55%" stop-color="#8b919c" />
            <stop offset="100%" stop-color="#3e444e" />
          </radialGradient>
          <radialGradient id={hub} cx="36%" cy="30%" r="68%">
            <stop offset="0%" stop-color="#f4f5f8" />
            <stop offset="42%" stop-color="#b4b8c2" />
            <stop offset="100%" stop-color="#5c626c" />
          </radialGradient>
          <radialGradient id={screw} cx="35%" cy="30%" r="65%">
            <stop offset="0%" stop-color="#e8eaee" />
            <stop offset="50%" stop-color="#9aa0aa" />
            <stop offset="100%" stop-color="#4e545e" />
          </radialGradient>
          <linearGradient id={glass} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(255,255,255,0.36)" />
            <stop offset="55%" stop-color="rgba(255,255,255,0.06)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0)" />
          </linearGradient>
          <clipPath id={faceClip}>
            <circle cx={CX} cy={CY} r={FACE_R} />
          </clipPath>
        </defs>

        <g filter={`url(#${shadow})`}>
          <circle cx={CX} cy={CY} r={BEZEL_R} fill="#1a1d24" />
        </g>
        <circle cx={CX} cy={CY + 1.7} r={BEZEL_R} fill={`url(#${bezelSide})`} />
        <circle cx={CX} cy={CY} r={BEZEL_R} fill={`url(#${bezelFace})`} />
        <circle cx={CX} cy={CY} r={BEZEL_R} fill={`url(#${bezelSheen})`} />
        <circle
          cx={CX}
          cy={CY}
          r={BEZEL_R - 0.45}
          fill="none"
          stroke="rgba(255,255,255,0.42)"
          stroke-width="0.85"
        />
        <circle
          cx={CX}
          cy={CY + 0.35}
          r={BEZEL_R - 0.55}
          fill="none"
          stroke="rgba(0,0,0,0.28)"
          stroke-width="0.7"
        />

        {SCREWS.map((item) => (
          <g key={item.deg} transform={`rotate(${item.deg + 90} ${item.x} ${item.y})`}>
            <circle cx={item.x} cy={item.y + 0.35} r="1.55" fill="rgba(20,22,28,0.45)" />
            <circle cx={item.x} cy={item.y} r="1.55" fill={`url(#${screw})`} />
            <circle
              cx={item.x}
              cy={item.y}
              r="1.55"
              fill="none"
              stroke="rgba(20,22,28,0.4)"
              stroke-width="0.35"
            />
            <rect
              x={item.x - 0.85}
              y={item.y - 0.28}
              width="1.7"
              height="0.56"
              rx="0.28"
              fill="#2a3038"
            />
            <ellipse
              cx={item.x - 0.35}
              cy={item.y - 0.45}
              rx="0.55"
              ry="0.38"
              fill="rgba(255,255,255,0.45)"
            />
          </g>
        ))}

        <circle cx={CX} cy={CY} r={WELL_R} fill={`url(#${well})`} />
        <circle
          cx={CX}
          cy={CY}
          r={WELL_R}
          fill="none"
          stroke="rgba(0,0,0,0.55)"
          stroke-width="1.1"
        />
        <circle cx={CX} cy={CY} r={FACE_R} fill={`url(#${face})`} />
        <circle
          cx={CX}
          cy={CY}
          r={FACE_R}
          fill="none"
          stroke="rgba(90,70,40,0.28)"
          stroke-width="0.7"
        />

        <g clip-path={`url(#${faceClip})`}>
          <ellipse cx={CX} cy={CY + 12.5} rx="14" ry="8.5" fill="rgba(90,70,40,0.12)" />
          <path
            d={GROOVE}
            fill="none"
            stroke="rgba(70,58,40,0.35)"
            stroke-width="3.7"
            stroke-linecap="round"
          />
          {BANDS.map((band) => (
            <path
              key={band.color}
              d={band.d}
              fill="none"
              stroke={band.color}
              stroke-width="2.7"
              stroke-linecap="round"
            />
          ))}
          <path
            d={GROOVE}
            fill="none"
            stroke="rgba(255,255,255,0.28)"
            stroke-width="0.7"
            stroke-linecap="round"
            transform="translate(0 -0.55)"
          />
          {TICKS.map((tick) => (
            <line
              key={`${tick.x1}-${tick.y1}`}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              stroke={tick.major ? 'rgba(70,58,42,0.78)' : 'rgba(70,58,42,0.48)'}
              stroke-width={tick.major ? 1.35 : 0.75}
              stroke-linecap="round"
            />
          ))}
        </g>

        <g transform={`rotate(${NEEDLE_ROT.toFixed(2)} ${CX} ${CY})`}>
          <g transform="translate(0.55 1.15)" opacity="0.28">
            <path d={`M ${CX} ${CY - 16.15} L ${CX + 1.85} ${CY + 4.15} L ${CX} ${CY + 2.5} L ${CX - 1.85} ${CY + 4.15} Z`} />
            <circle cx={CX} cy={CY + 5.85} r="2.55" />
          </g>
          <path
            d={`M ${CX} ${CY - 16.25} L ${CX} ${CY + 2.5} L ${CX - 1.85} ${CY + 4.15} Z`}
            fill={`url(#${needleL})`}
          />
          <path
            d={`M ${CX} ${CY - 16.25} L ${CX + 1.85} ${CY + 4.15} L ${CX} ${CY + 2.5} Z`}
            fill={`url(#${needleR})`}
          />
          <circle cx={CX} cy={CY + 5.85} r="2.6" fill={`url(#${bob})`} />
          <circle
            cx={CX}
            cy={CY + 5.85}
            r="2.6"
            fill="none"
            stroke="rgba(20,22,28,0.4)"
            stroke-width="0.4"
          />
          <ellipse cx={CX - 0.55} cy={CY + 5.2} rx="1.05" ry="0.7" fill="rgba(255,255,255,0.35)" />
        </g>

        <circle cx={CX} cy={CY + 0.35} r="4.05" fill="rgba(20,22,28,0.28)" />
        <circle cx={CX} cy={CY} r="3.85" fill={`url(#${hub})`} />
        <circle
          cx={CX}
          cy={CY}
          r="3.85"
          fill="none"
          stroke="rgba(20,22,28,0.4)"
          stroke-width="0.45"
        />
        <circle cx={CX} cy={CY} r="2.35" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="0.55" />
        <circle cx={CX} cy={CY} r="1.35" fill="#3a4048" />
        <circle cx={CX} cy={CY} r="1.35" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="0.35" />
        <ellipse cx={CX - 0.85} cy={CY - 1.05} rx="1.35" ry="0.95" fill="rgba(255,255,255,0.5)" />

        <g clip-path={`url(#${faceClip})`} pointer-events="none">
          <ellipse cx={CX - 1.2} cy={CY - 7.8} rx="13.2" ry="8.2" fill={`url(#${glass})`} />
          <path
            d={`M ${CX - 14.2} ${CY - 4.2} A ${FACE_R} ${FACE_R} 0 0 1 ${CX + 12.8} ${CY - 8.4}`}
            fill="none"
            stroke="rgba(255,255,255,0.26)"
            stroke-width="1.1"
            stroke-linecap="round"
          />
        </g>
      </svg>
    </AppIconTile>
  )
}
