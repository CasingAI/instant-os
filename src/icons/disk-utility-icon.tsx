import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `disk-utility-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

const CX = 32
const CY = 32
const DISK_R = 24
const HUB_R = 6
const PARTITION_A_START = 0
const PARTITION_A_END = 135
const PARTITION_B_START = 135
const PARTITION_B_END = 220
const PARTITION_C_START = 220
const PARTITION_C_END = 360

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  let delta = a1 - a0
  while (delta <= 0) delta += 360
  const large: 0 | 1 = delta > 180 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

function partitionPath(startDeg: number, endDeg: number, innerR: number, outerR: number): string {
  const [ix0, iy0] = polar(CX, CY, innerR, startDeg)
  const [ox0, oy0] = polar(CX, CY, outerR, startDeg)
  const [ox1, oy1] = polar(CX, CY, outerR, endDeg)
  const [ix1, iy1] = polar(CX, CY, innerR, endDeg)

  let delta = endDeg - startDeg
  while (delta <= 0) delta += 360
  const large: 0 | 1 = delta > 180 ? 1 : 0

  return [
    `M ${ox0.toFixed(2)} ${oy0.toFixed(2)}`,
    `A ${outerR.toFixed(2)} ${outerR.toFixed(2)} 0 ${large} 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)}`,
    `L ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
    `A ${innerR.toFixed(2)} ${innerR.toFixed(2)} 0 ${large} 0 ${ix0.toFixed(2)} ${iy0.toFixed(2)}`,
    'Z',
  ].join(' ')
}

/**
 * iOS 6 拟物磁盘图标：盘片上分区色块 + 中心轮毂，
 * 对应磁盘工具显示卷、镜像与分区信息。
 */
export function DiskUtilityIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const bevel = svgUid(rawId, 'bevel')
  const face = svgUid(rawId, 'face')
  const sheen = svgUid(rawId, 'sheen')
  const partA = svgUid(rawId, 'part-a')
  const partB = svgUid(rawId, 'part-b')
  const partC = svgUid(rawId, 'part-c')
  const hub = svgUid(rawId, 'hub')
  const ring = svgUid(rawId, 'ring')

  return (
    <AppIconTile color="#2f3640" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-25%" y="-20%" width="150%" height="150%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="blur" />
            <feOffset dx="0.4" dy="1.6" result="off" />
            <feFlood floodColor="#0d1117" floodOpacity="0.55" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={bevel} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7f8fb" />
            <stop offset="18%" stopColor="#d5d8e0" />
            <stop offset="52%" stopColor="#9aa0ab" />
            <stop offset="74%" stopColor="#eceef3" />
            <stop offset="100%" stopColor="#4a505a" />
          </linearGradient>
          <radialGradient id={face} cx="44%" cy="38%" r="66%">
            <stop offset="0%" stopColor="#e8eef8" />
            <stop offset="52%" stopColor="#dbe2ee" />
            <stop offset="100%" stopColor="#a7b4c5" />
          </radialGradient>
          <radialGradient id={sheen} cx="34%" cy="26%" r="68%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.48)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <linearGradient id={partA} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
          <linearGradient id={partB} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id={partC} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <radialGradient id={hub} cx="36%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="60%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#475569" />
          </radialGradient>
          <radialGradient id={ring} cx="50%" cy="46%" r="54%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </radialGradient>
        </defs>

        <g filter={`url(#${shadow})`}>
          <circle cx={CX} cy={CY} r={DISK_R} fill="#111827" />
        </g>
        <circle cx={CX} cy={CY + 1.4} r={DISK_R} fill={`url(#${bevel})`} />
        <circle cx={CX} cy={CY} r={DISK_R} fill={`url(#${face})`} />
        <circle cx={CX} cy={CY} r={DISK_R} fill={`url(#${sheen})`} />
        <circle
          cx={CX}
          cy={CY}
          r={DISK_R - 0.35}
          fill="none"
          stroke="rgba(255,255,255,0.48)"
          strokeWidth="0.8"
        />
        <circle
          cx={CX}
          cy={CY + 0.25}
          r={DISK_R - 0.55}
          fill="none"
          stroke="rgba(0,0,0,0.28)"
          strokeWidth="0.7"
        />

        <path
          d={partitionPath(PARTITION_A_START, PARTITION_A_END, HUB_R + 2, DISK_R - 1.4)}
          fill={`url(#${partA})`}
          opacity="0.88"
        />
        <path
          d={partitionPath(PARTITION_B_START, PARTITION_B_END, HUB_R + 2, DISK_R - 1.4)}
          fill={`url(#${partB})`}
          opacity="0.88"
        />
        <path
          d={partitionPath(PARTITION_C_START, PARTITION_C_END, HUB_R + 2, DISK_R - 1.4)}
          fill={`url(#${partC})`}
          opacity="0.88"
        />

        <circle cx={CX} cy={CY} r={HUB_R + 2.4} fill={`url(#${ring})`} />
        <circle
          cx={CX}
          cy={CY}
          r={HUB_R + 1.2}
          fill="none"
          stroke="rgba(255,255,255,0.32)"
          strokeWidth="0.6"
        />
        <circle cx={CX} cy={CY} r={HUB_R} fill={`url(#${hub})`} />
        <circle
          cx={CX}
          cy={CY}
          r={HUB_R}
          fill="none"
          stroke="rgba(20,26,36,0.45)"
          strokeWidth="0.5"
        />

        <path
          d={arcPath(CX, CY, DISK_R - 7.6, PARTITION_A_START, PARTITION_C_END)}
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="0.7"
          strokeLinecap="round"
        />
      </svg>
    </AppIconTile>
  )
}
