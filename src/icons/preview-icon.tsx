import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `preview-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2)
  return [
    `M ${(x + radius).toFixed(2)} ${y.toFixed(2)}`,
    `H ${(x + w - radius).toFixed(2)}`,
    `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(x + w).toFixed(2)} ${(y + radius).toFixed(2)}`,
    `V ${(y + h - radius).toFixed(2)}`,
    `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(x + w - radius).toFixed(2)} ${(y + h).toFixed(2)}`,
    `H ${(x + radius).toFixed(2)}`,
    `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${x.toFixed(2)} ${(y + h - radius).toFixed(2)}`,
    `V ${(y + radius).toFixed(2)}`,
    `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(x + radius).toFixed(2)} ${y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

/** 透视圆锥台：上小下大，底边走椭圆前弧。 */
function frustumPath(
  cx: number,
  topY: number,
  botY: number,
  topRx: number,
  topRy: number,
  botRx: number,
  botRy: number,
): string {
  const topL = cx - topRx
  const topR = cx + topRx
  const botL = cx - botRx
  const botR = cx + botRx
  return [
    `M ${topL.toFixed(2)} ${topY.toFixed(2)}`,
    `L ${botL.toFixed(2)} ${botY.toFixed(2)}`,
    `A ${botRx.toFixed(2)} ${botRy.toFixed(2)} 0 0 1 ${botR.toFixed(2)} ${botY.toFixed(2)}`,
    `L ${topR.toFixed(2)} ${topY.toFixed(2)}`,
    `A ${topRx.toFixed(2)} ${topRy.toFixed(2)} 0 0 0 ${topL.toFixed(2)} ${topY.toFixed(2)}`,
    'Z',
  ].join(' ')
}

function cylinderSide(cx: number, topY: number, botY: number, rx: number, ry: number): string {
  return frustumPath(cx, topY, botY, rx, ry, rx, ry)
}

const TILE_RX = 14
const FRAME_OUTER = roundedRectPath(6.1, 6.1, 51.8, 51.8, 12.4)
const FRAME_INNER = roundedRectPath(11.0, 11.0, 42.0, 42.0, 8.4)
const FRAME_HOLE = `${FRAME_OUTER} ${FRAME_INNER}`

const LOUPE_CX = 45.6
const CAP_TOP_Y = 35.4
const CAP_BOT_Y = 41.6
const CAP_RX = 11.05
const CAP_RY = 3.9
const GLASS_TOP_Y = 41.15
const GLASS_BOT_Y = 57.35
const GLASS_TOP_RX = 10.05
const GLASS_TOP_RY = 3.45
const GLASS_BOT_RX = 15.7
const GLASS_BOT_RY = 5.45
const INNER_TOP_Y = 42.5
const INNER_BOT_Y = 56.45
const INNER_TOP_RX = 8.15
const INNER_TOP_RY = 2.75
const INNER_BOT_RX = 14.15
const INNER_BOT_RY = 4.85

const GLASS_OUTER = frustumPath(
  LOUPE_CX,
  GLASS_TOP_Y,
  GLASS_BOT_Y,
  GLASS_TOP_RX,
  GLASS_TOP_RY,
  GLASS_BOT_RX,
  GLASS_BOT_RY,
)
const GLASS_INNER = frustumPath(
  LOUPE_CX,
  INNER_TOP_Y,
  INNER_BOT_Y,
  INNER_TOP_RX,
  INNER_TOP_RY,
  INNER_BOT_RX,
  INNER_BOT_RY,
)
const CAP_SIDE = cylinderSide(LOUPE_CX, CAP_TOP_Y, CAP_BOT_Y, CAP_RX, CAP_RY)

const KNURL_XS = Array.from({ length: 15 }, (_, i) => {
  const t = (i + 0.5) / 15
  return LOUPE_CX - CAP_RX * Math.cos(t * Math.PI)
})

type SeascapeGradients = {
  sky: string
  sea: string
  seaDeep: string
}

function Seascape({ sky, sea, seaDeep }: SeascapeGradients) {
  return (
    <g>
      <rect width="64" height="28" fill={`url(#${sky})`} />
      <rect x="0" y="24.5" width="64" height="20" fill={`url(#${sea})`} />
      <path d="M 0 25.8 C 10 24.6 20 27.2 32 25.6 C 44 24.1 54 27 64 25.4 L 64 31 L 0 31 Z" fill="#8ebed8" opacity="0.4" />
      <path d="M 0 31.5 C 14 30 24 33.8 36 31.8 C 48 30 56 33.6 64 32 L 64 42 L 0 42 Z" fill={`url(#${seaDeep})`} />
      <path d="M 0 38.5 C 10 36.8 22 41 34 38.6 C 46 36.4 56 40.8 64 38.8 L 64 64 L 0 64 Z" fill="#16344e" />
      <path d="M 2 43.5 C 12 40.6 20 46.4 32 43.2 C 42 40.6 50 46.2 62 43.6 L 64 50 C 52 53.5 40 49.2 28 52.2 C 16 55 6 50.6 0 51.4 Z" fill="#3e342c" />
      <path d="M 10 45.2 C 18 42.8 26 48.4 36 45.4 C 44 43.2 52 48.2 62 45.8 L 64 52.2 C 52 55 40 51 30 53.6 C 20 56 10 51.8 8 52 Z" fill="#6a5a48" />
      <ellipse cx="24" cy="48.6" rx="8.4" ry="4.2" fill="#2c2620" />
      <ellipse cx="40" cy="49.4" rx="9.6" ry="4.6" fill="#4a4036" />
      <ellipse cx="50.5" cy="47.2" rx="7.2" ry="3.4" fill="#2a241e" />
      <ellipse cx="33" cy="51.2" rx="6.4" ry="2.8" fill="#5c5044" />
      <ellipse cx="42.4" cy="47.6" rx="3.4" ry="1.45" fill="#7a6c5c" />
      <ellipse cx="51.2" cy="46.4" rx="2.5" ry="1.15" fill="#8a7c6c" />
      <ellipse cx="47.2" cy="49.6" rx="3.6" ry="1.55" fill="#2f6a88" />
      <ellipse cx="36.5" cy="50.2" rx="2.4" ry="1.05" fill="#3a7a96" />
      <ellipse cx="18" cy="44.6" rx="5.2" ry="1.15" fill="rgba(245,250,255,0.72)" />
      <ellipse cx="31" cy="43.7" rx="6.1" ry="1.25" fill="rgba(245,250,255,0.58)" />
      <ellipse cx="46.5" cy="44.5" rx="5.4" ry="1.1" fill="rgba(245,250,255,0.7)" />
      <ellipse cx="56" cy="45.2" rx="3.2" ry="0.85" fill="rgba(245,250,255,0.45)" />
    </g>
  )
}

/**
 * 预览：端正的白框风景照 + 压在右下角的珠宝放大镜。
 * 构图对齐 macOS Preview：照片铺满圆角窗，锥形玻璃里是放大后的礁石与海面。
 */
export function PreviewIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const sky = svgUid(rawId, 'sky')
  const sea = svgUid(rawId, 'sea')
  const seaDeep = svgUid(rawId, 'sea-deep')
  const bezel = svgUid(rawId, 'bezel')
  const capTop = svgUid(rawId, 'cap-top')
  const capSide = svgUid(rawId, 'cap-side')
  const glassWall = svgUid(rawId, 'glass-wall')
  const glassShine = svgUid(rawId, 'glass-shine')
  const shadow = svgUid(rawId, 'shadow')
  const photoClip = svgUid(rawId, 'photo-clip')
  const innerClip = svgUid(rawId, 'inner-clip')
  const wallClip = svgUid(rawId, 'wall-clip')
  const capSideClip = svgUid(rawId, 'cap-side-clip')
  const tileClip = svgUid(rawId, 'tile-clip')

  return (
    <AppIconTile color="#3b9ae8" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <clipPath id={tileClip}>
            <rect x="0" y="0" width="64" height="64" rx={TILE_RX} ry={TILE_RX} />
          </clipPath>
          <clipPath id={photoClip}>
            <path d={FRAME_INNER} />
          </clipPath>
          <clipPath id={innerClip}>
            <path d={GLASS_INNER} />
          </clipPath>
          <clipPath id={wallClip} clip-rule="evenodd">
            <path d={`${GLASS_OUTER} ${GLASS_INNER}`} clip-rule="evenodd" />
          </clipPath>
          <clipPath id={capSideClip}>
            <path d={CAP_SIDE} />
          </clipPath>
          <filter id={shadow} x="-50%" y="-20%" width="200%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.35" result="blur" />
            <feOffset dx="0.4" dy="1.5" result="off" />
            <feFlood flood-color="#12304a" flood-opacity="0.42" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#c5dff2" />
            <stop offset="70%" stop-color="#8ebcd8" />
            <stop offset="100%" stop-color="#6ea4c8" />
          </linearGradient>
          <linearGradient id={sea} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4a86b4" />
            <stop offset="100%" stop-color="#2a5a86" />
          </linearGradient>
          <linearGradient id={seaDeep} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2e628c" />
            <stop offset="100%" stop-color="#16344e" />
          </linearGradient>
          <linearGradient id={bezel} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="48%" stop-color="#f3f5f8" />
            <stop offset="100%" stop-color="#d4dbe4" />
          </linearGradient>
          <radialGradient id={capTop} cx="42%" cy="38%" r="68%">
            <stop offset="0%" stop-color="#3a3a3e" />
            <stop offset="55%" stop-color="#1c1c1e" />
            <stop offset="100%" stop-color="#0a0a0c" />
          </radialGradient>
          <linearGradient id={capSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2a2a2e" />
            <stop offset="40%" stop-color="#141416" />
            <stop offset="100%" stop-color="#050506" />
          </linearGradient>
          <linearGradient id={glassWall} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="rgba(255,255,255,0.55)" />
            <stop offset="18%" stop-color="rgba(210,230,245,0.12)" />
            <stop offset="82%" stop-color="rgba(180,205,225,0.08)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0.42)" />
          </linearGradient>
          <linearGradient id={glassShine} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(255,255,255,0.5)" />
            <stop offset="55%" stop-color="rgba(255,255,255,0.05)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>

        <g clip-path={`url(#${tileClip})`}>
          <g clip-path={`url(#${photoClip})`}>
            <Seascape sky={sky} sea={sea} seaDeep={seaDeep} />
          </g>
          <path d={FRAME_INNER} fill="none" stroke="rgba(20,40,60,0.22)" stroke-width="0.7" />
          <path d={FRAME_HOLE} fill={`url(#${bezel})`} fill-rule="evenodd" />
          <path d={FRAME_OUTER} fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="0.8" />
          <path d={FRAME_INNER} fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.55" />

          <g filter={`url(#${shadow})`}>
            <ellipse cx={LOUPE_CX + 0.4} cy={GLASS_BOT_Y + 1.1} rx={GLASS_BOT_RX * 0.92} ry={GLASS_BOT_RY * 0.7} fill="#000" />
            <path d={GLASS_OUTER} fill="#000" />
            <path d={CAP_SIDE} fill="#000" />
          </g>

          <g clip-path={`url(#${innerClip})`}>
            <g
              transform={`translate(${LOUPE_CX} ${46.6}) scale(2.28) translate(${-LOUPE_CX} ${-46.6})`}
            >
              <Seascape sky={sky} sea={sea} seaDeep={seaDeep} />
            </g>
          </g>

          <g clip-path={`url(#${wallClip})`}>
            <path d={GLASS_OUTER} fill={`url(#${glassWall})`} />
            <path d={GLASS_OUTER} fill="rgba(190,215,235,0.16)" />
          </g>
          <path
            d={GLASS_INNER}
            fill="none"
            stroke="rgba(255,255,255,0.35)"
            stroke-width="0.55"
          />
          <path
            d={`M ${(LOUPE_CX - GLASS_TOP_RX + 1.6).toFixed(2)} ${(GLASS_TOP_Y + 0.8).toFixed(2)} L ${(LOUPE_CX - GLASS_BOT_RX + 3.2).toFixed(2)} ${(GLASS_BOT_Y - 1.2).toFixed(2)}`}
            fill="none"
            stroke="rgba(255,255,255,0.7)"
            stroke-width="1.35"
            stroke-linecap="round"
          />
          <path
            d={`M ${(LOUPE_CX + GLASS_TOP_RX - 1.4).toFixed(2)} ${(GLASS_TOP_Y + 1.1).toFixed(2)} L ${(LOUPE_CX + GLASS_BOT_RX - 2.8).toFixed(2)} ${(GLASS_BOT_Y - 1.4).toFixed(2)}`}
            fill="none"
            stroke="rgba(255,255,255,0.28)"
            stroke-width="0.9"
            stroke-linecap="round"
          />
          <ellipse
            cx={LOUPE_CX}
            cy={GLASS_BOT_Y}
            rx={GLASS_BOT_RX}
            ry={GLASS_BOT_RY}
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            stroke-width="0.85"
          />
          <ellipse
            cx={LOUPE_CX}
            cy={GLASS_BOT_Y - 0.15}
            rx={INNER_BOT_RX}
            ry={INNER_BOT_RY}
            fill="none"
            stroke="rgba(20,40,60,0.2)"
            stroke-width="0.5"
          />
          <path
            d={`M ${(LOUPE_CX - 6.2).toFixed(2)} ${(GLASS_TOP_Y + 3.2).toFixed(2)} L ${(LOUPE_CX - 9.4).toFixed(2)} ${(GLASS_BOT_Y - 6.5).toFixed(2)}`}
            fill="none"
            stroke={`url(#${glassShine})`}
            stroke-width="3.2"
            stroke-linecap="round"
            opacity="0.55"
          />

          <path d={CAP_SIDE} fill={`url(#${capSide})`} />
          <g clip-path={`url(#${capSideClip})`}>
            {KNURL_XS.map((x) => (
              <line
                key={x.toFixed(3)}
                x1={x}
                y1={CAP_TOP_Y - 1}
                x2={x}
                y2={CAP_BOT_Y + 4}
                stroke="rgba(255,255,255,0.12)"
                stroke-width="0.55"
              />
            ))}
            {KNURL_XS.map((x) => (
              <line
                key={`d-${x.toFixed(3)}`}
                x1={x + 0.55}
                y1={CAP_TOP_Y - 1}
                x2={x + 0.55}
                y2={CAP_BOT_Y + 4}
                stroke="rgba(0,0,0,0.45)"
                stroke-width="0.55"
              />
            ))}
          </g>
          <ellipse
            cx={LOUPE_CX}
            cy={CAP_BOT_Y}
            rx={CAP_RX}
            ry={CAP_RY}
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            stroke-width="0.6"
          />
          <ellipse cx={LOUPE_CX} cy={CAP_TOP_Y} rx={CAP_RX} ry={CAP_RY} fill={`url(#${capTop})`} />
          <ellipse
            cx={LOUPE_CX}
            cy={CAP_TOP_Y}
            rx={CAP_RX}
            ry={CAP_RY}
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            stroke-width="0.55"
          />
          <ellipse
            cx={LOUPE_CX - 0.2}
            cy={CAP_TOP_Y}
            rx="4.85"
            ry="1.72"
            fill="#0b0b0d"
            stroke="rgba(90,90,96,0.7)"
            stroke-width="0.55"
          />
          <ellipse cx={LOUPE_CX - 0.2} cy={CAP_TOP_Y + 0.15} rx="3.6" ry="1.05" fill="#000" />
          <ellipse cx={LOUPE_CX - 1.1} cy={CAP_TOP_Y - 0.35} rx="1.7" ry="0.45" fill="rgba(255,255,255,0.16)" />
        </g>
      </svg>
    </AppIconTile>
  )
}
