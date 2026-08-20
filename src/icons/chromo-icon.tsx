import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `chromo-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function pieSlice(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const delta = ((a1 - a0) % 360 + 360) % 360
  const large = delta > 180 ? 1 : 0
  return [
    `M ${cx.toFixed(2)} ${cy.toFixed(2)}`,
    `L ${x0.toFixed(2)} ${y0.toFixed(2)}`,
    `A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    'Z',
  ].join(' ')
}

function annularWedge(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  a0: number,
  a1: number,
): string {
  const [x0, y0] = polar(cx, cy, rOuter, a0)
  const [x1, y1] = polar(cx, cy, rOuter, a1)
  const [x2, y2] = polar(cx, cy, rInner, a1)
  const [x3, y3] = polar(cx, cy, rInner, a0)
  const delta = ((a1 - a0) % 360 + 360) % 360
  const large = delta > 180 ? 1 : 0
  return [
    `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
    `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    'Z',
  ].join(' ')
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  sweep: 0 | 1 = 1,
): string {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const delta = sweep === 1 ? ((a1 - a0) % 360 + 360) % 360 : ((a0 - a1) % 360 + 360) % 360
  const large = delta > 180 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

function ringHolePath(cx: number, cy: number, rOuter: number, rInner: number): string {
  const [xo, yo] = polar(cx, cy, rOuter, 0)
  const [xi, yi] = polar(cx, cy, rInner, 0)
  return [
    `M ${xo.toFixed(2)} ${yo.toFixed(2)}`,
    `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 1 1 ${(cx - rOuter).toFixed(2)} ${yo.toFixed(2)}`,
    `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 1 1 ${xo.toFixed(2)} ${yo.toFixed(2)}`,
    `M ${xi.toFixed(2)} ${yi.toFixed(2)}`,
    `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 1 0 ${(cx - rInner).toFixed(2)} ${yi.toFixed(2)}`,
    `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 1 0 ${xi.toFixed(2)} ${yi.toFixed(2)}`,
    'Z',
  ].join(' ')
}

const CX = 32
const CY = 31.05
const R_SPHERE = 23.55
const R_RING_OUTER = 10.45
const R_RING_INNER = 7.72
const R_HUB = 7.28
const R_FOLD = 10.85
const R_SEAM_INNER = 9.2

/** 红在右上、绿在右下、黄在左侧，各 120°。 */
const RED_A0 = 228
const RED_A1 = 348
const GREEN_A0 = 348
const GREEN_A1 = 108
const YELLOW_A0 = 108
const YELLOW_A1 = 228

const RED_PETAL = pieSlice(CX, CY, R_SPHERE, RED_A0, RED_A1)
const GREEN_PETAL = pieSlice(CX, CY, R_SPHERE, GREEN_A0, GREEN_A1)
const YELLOW_PETAL = pieSlice(CX, CY, R_SPHERE, YELLOW_A0, YELLOW_A1)
const SEAM_RED_GREEN = annularWedge(CX, CY, R_SEAM_INNER, R_SPHERE, 344, 352)
const SEAM_GREEN_YELLOW = annularWedge(CX, CY, R_SEAM_INNER, R_SPHERE, 104, 112)
const SEAM_YELLOW_RED = annularWedge(CX, CY, R_SEAM_INNER, R_SPHERE, 224, 232)
const FOLD_RED = arcPath(CX, CY, R_FOLD, 236, 340)
const FOLD_GREEN = arcPath(CX, CY, R_FOLD, 356, 100)
const FOLD_YELLOW = arcPath(CX, CY, R_FOLD, 116, 220)
const RING_PATH = ringHolePath(CX, CY, R_RING_OUTER, R_RING_INNER)
const RING_HIGHLIGHT = arcPath(CX, CY, 9.15, 200, 310)
const RING_SHADOW = arcPath(CX, CY, 9.15, 20, 130)
const RING_INNER_HIGHLIGHT = arcPath(CX, CY, 7.85, 30, 140)
const RIM_HIGHLIGHT = arcPath(CX, CY, 23.05, 200, 320)
const RIM_SHADOW = arcPath(CX, CY, 23.2, 20, 140)
const RED_RIM = arcPath(CX, CY, R_SPHERE, RED_A0, RED_A1)
const GREEN_RIM = arcPath(CX, CY, R_SPHERE, GREEN_A0, GREEN_A1)
const YELLOW_RIM = arcPath(CX, CY, R_SPHERE, YELLOW_A0, YELLOW_A1)

/**
 * 拟物三色球面：红、黄、绿瓣裹在玻璃球上，中间凹槽嵌一颗蓝钮。
 * 侧壁、接缝阴影和高光让它读成立体球，而不是扁平饼图。
 */
export function ChromoIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const sphereClip = svgUid(rawId, 'clip')
  const red = svgUid(rawId, 'red')
  const green = svgUid(rawId, 'green')
  const yellow = svgUid(rawId, 'yellow')
  const shade = svgUid(rawId, 'shade')
  const rim = svgUid(rawId, 'rim')
  const ring = svgUid(rawId, 'ring')
  const hub = svgUid(rawId, 'hub')
  const hubGloss = svgUid(rawId, 'hub-gloss')
  const sphereGloss = svgUid(rawId, 'gloss')

  return (
    <AppIconTile color="#dce3ec" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="blur" />
            <feOffset dx="0.6" dy="1.9" result="off" />
            <feFlood flood-color="#2a3540" flood-opacity="0.48" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <clipPath id={sphereClip}>
            <circle cx={CX} cy={CY} r={R_SPHERE} />
          </clipPath>
          <radialGradient id={red} cx="34%" cy="26%" r="78%">
            <stop offset="0%" stop-color="#ffb0a4" />
            <stop offset="28%" stop-color="#ff6a58" />
            <stop offset="58%" stop-color="#ea4335" />
            <stop offset="100%" stop-color="#8e1a14" />
          </radialGradient>
          <radialGradient id={green} cx="48%" cy="42%" r="80%">
            <stop offset="0%" stop-color="#a8f0c8" />
            <stop offset="28%" stop-color="#5ed68a" />
            <stop offset="58%" stop-color="#34a853" />
            <stop offset="100%" stop-color="#156330" />
          </radialGradient>
          <radialGradient id={yellow} cx="30%" cy="40%" r="80%">
            <stop offset="0%" stop-color="#ffe9a0" />
            <stop offset="30%" stop-color="#ffd24a" />
            <stop offset="60%" stop-color="#fbbc04" />
            <stop offset="100%" stop-color="#a87800" />
          </radialGradient>
          <radialGradient id={shade} cx="36%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0" />
            <stop offset="42%" stop-color="#000000" stop-opacity="0" />
            <stop offset="72%" stop-color="#000000" stop-opacity="0.16" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.46" />
          </radialGradient>
          <radialGradient id={rim} cx="38%" cy="28%" r="72%">
            <stop offset="0%" stop-color="#f7fbff" />
            <stop offset="55%" stop-color="#c5ced8" />
            <stop offset="100%" stop-color="#5a6570" />
          </radialGradient>
          <linearGradient id={ring} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="45%" stop-color="#e8eef4" />
            <stop offset="100%" stop-color="#9aa6b2" />
          </linearGradient>
          <radialGradient id={hub} cx="34%" cy="30%" r="68%">
            <stop offset="0%" stop-color="#c5ddff" />
            <stop offset="28%" stop-color="#7ab2ff" />
            <stop offset="58%" stop-color="#4285f4" />
            <stop offset="82%" stop-color="#1a63d4" />
            <stop offset="100%" stop-color="#0b3d96" />
          </radialGradient>
          <radialGradient id={hubGloss} cx="38%" cy="32%" r="50%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.8" />
            <stop offset="55%" stop-color="#ffffff" stop-opacity="0.16" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
          </radialGradient>
          <radialGradient id={sphereGloss} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.7" />
            <stop offset="42%" stop-color="#ffffff" stop-opacity="0.2" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="32.4" cy="55.6" rx="20.5" ry="3.4" fill="rgba(30,40,50,0.28)" />

        <circle cx="32.35" cy="32.35" r="23.7" fill="#4a5560" filter={`url(#${shadow})`} />
        <circle cx="32.2" cy="32.15" r="23.7" fill={`url(#${rim})`} />

        <g clip-path={`url(#${sphereClip})`}>
          <path d={YELLOW_PETAL} fill={`url(#${yellow})`} />
          <path d={GREEN_PETAL} fill={`url(#${green})`} />
          <path d={RED_PETAL} fill={`url(#${red})`} />

          <path d={SEAM_RED_GREEN} fill="rgba(40,12,8,0.38)" />
          <path d={SEAM_GREEN_YELLOW} fill="rgba(8,32,16,0.38)" />
          <path d={SEAM_YELLOW_RED} fill="rgba(48,28,0,0.34)" />

          <path d={RED_RIM} fill="none" stroke="rgba(255,220,210,0.28)" stroke-width="1.1" />
          <path d={GREEN_RIM} fill="none" stroke="rgba(210,255,230,0.18)" stroke-width="1.1" />
          <path d={YELLOW_RIM} fill="none" stroke="rgba(255,240,180,0.2)" stroke-width="1.1" />

          <circle cx={CX} cy={CY} r={R_SPHERE} fill={`url(#${shade})`} />

          <circle
            cx={CX}
            cy={CY}
            r="10.95"
            fill="none"
            stroke="rgba(0,0,0,0.26)"
            stroke-width="1.7"
          />
          <path
            d={FOLD_RED}
            fill="none"
            stroke="rgba(80,12,8,0.4)"
            stroke-width="1.1"
            stroke-linecap="round"
          />
          <path
            d={FOLD_GREEN}
            fill="none"
            stroke="rgba(8,40,18,0.4)"
            stroke-width="1.1"
            stroke-linecap="round"
          />
          <path
            d={FOLD_YELLOW}
            fill="none"
            stroke="rgba(70,48,0,0.36)"
            stroke-width="1.1"
            stroke-linecap="round"
          />
        </g>

        <circle
          cx={CX}
          cy={CY}
          r={R_SPHERE}
          fill="none"
          stroke="rgba(20,28,36,0.45)"
          stroke-width="0.85"
        />
        <path
          d={RIM_HIGHLIGHT}
          fill="none"
          stroke="rgba(255,255,255,0.42)"
          stroke-width="1.15"
          stroke-linecap="round"
        />
        <path
          d={RIM_SHADOW}
          fill="none"
          stroke="rgba(0,0,0,0.22)"
          stroke-width="1.2"
          stroke-linecap="round"
        />

        <circle cx="32.15" cy="31.35" r="10.7" fill="rgba(24,32,42,0.28)" />
        <path d={RING_PATH} fill={`url(#${ring})`} fill-rule="evenodd" />
        <circle
          cx={CX}
          cy={CY}
          r={R_RING_OUTER}
          fill="none"
          stroke="rgba(60,70,80,0.4)"
          stroke-width="0.55"
        />
        <circle
          cx={CX}
          cy={CY}
          r={R_RING_INNER}
          fill="none"
          stroke="rgba(40,50,62,0.38)"
          stroke-width="0.55"
        />
        <path
          d={RING_HIGHLIGHT}
          fill="none"
          stroke="rgba(255,255,255,0.9)"
          stroke-width="1.25"
          stroke-linecap="round"
        />
        <path
          d={RING_SHADOW}
          fill="none"
          stroke="rgba(70,80,92,0.38)"
          stroke-width="1.05"
          stroke-linecap="round"
        />
        <path
          d={RING_INNER_HIGHLIGHT}
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          stroke-width="0.7"
          stroke-linecap="round"
        />

        <circle cx="32.12" cy="31.28" r="7.42" fill="rgba(8,28,80,0.32)" />
        <circle cx={CX} cy={CY} r={R_HUB} fill={`url(#${hub})`} />
        <circle
          cx={CX}
          cy={CY}
          r={R_HUB}
          fill="none"
          stroke="rgba(8,32,90,0.48)"
          stroke-width="0.5"
        />
        <circle
          cx={CX}
          cy={CY}
          r="6.7"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          stroke-width="0.65"
        />
        <ellipse cx="29.45" cy="28.65" rx="3.2" ry="2.15" fill={`url(#${hubGloss})`} />
        <ellipse cx="29.2" cy="28.3" rx="1.05" ry="0.62" fill="rgba(255,255,255,0.68)" />

        <ellipse
          cx="23.6"
          cy="21.4"
          rx="11.4"
          ry="7.1"
          fill={`url(#${sphereGloss})`}
          opacity="0.88"
        />
        <ellipse cx="22.4" cy="19.8" rx="4.6" ry="2.15" fill="rgba(255,255,255,0.34)" />
      </svg>
    </AppIconTile>
  )
}
