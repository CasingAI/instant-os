import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `marketplace-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
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

const PENCIL_TF = 'translate(16.0 48.7) rotate(-67)'
const BRUSH_TF = 'translate(48.0 48.7) rotate(-113)'
const RULER_TF = 'translate(32 33.6) rotate(7)'

/** 沿局部 +x 的铅笔外轮廓：橡皮圆头 → 笔杆 → 削尖。 */
const PENCIL_SILHOUETTE = [
  'M 1.15 -3.55',
  'H 32.4',
  'L 41.5 0',
  'L 32.4 3.55',
  'H 1.15',
  'A 1.15 1.15 0 0 1 0 2.4',
  'V -2.4',
  'A 1.15 1.15 0 0 1 1.15 -3.55',
  'Z',
].join(' ')

/** 画笔外轮廓：锥柄 → 金属箍 → 尖头笔毛。 */
const BRUSH_SILHOUETTE = [
  'M 2.35 -2.25',
  'C 0.45 -2.25 0.12 -1.05 0.12 0',
  'C 0.12 1.05 0.45 2.25 2.35 2.25',
  'L 24.8 3.05',
  'L 30.1 3.1',
  'C 34.8 3.85 38.4 2.35 41.5 0',
  'C 38.4 -2.35 34.8 -3.85 30.1 -3.1',
  'L 24.8 -3.05',
  'Z',
].join(' ')

const RULER_PATH = roundedRectPath(-14.4, -3.5, 28.8, 7.0, 0.9)

const RULER_TICKS = [ -10.6, -8.2, -5.8, -3.4, -1.0, 1.4, 3.8, 6.2, 8.6, 11.0 ] as const

/**
 * iOS 6 应用商店：黄铅笔、棕画笔、木尺交叉成 A。
 * 侧壁下移、高光与材质分层，让笔画读成立体工具而不是描边。
 */
export function MarketplaceIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const pencilBody = svgUid(rawId, 'pencil-body')
  const pencilEraser = svgUid(rawId, 'pencil-eraser')
  const pencilFerrule = svgUid(rawId, 'pencil-ferrule')
  const pencilCone = svgUid(rawId, 'pencil-cone')
  const pencilLead = svgUid(rawId, 'pencil-lead')
  const brushHandle = svgUid(rawId, 'brush-handle')
  const brushFerrule = svgUid(rawId, 'brush-ferrule')
  const brushHair = svgUid(rawId, 'brush-hair')
  const rulerFace = svgUid(rawId, 'ruler-face')
  const rulerSide = svgUid(rawId, 'ruler-side')

  return (
    <AppIconTile color="#0a84ff" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-35%" y="-20%" width="170%" height="170%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.25" result="blur" />
            <feOffset dx="0.7" dy="1.6" result="off" />
            <feFlood flood-color="#03284d" flood-opacity="0.5" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={pencilBody} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff1a3" />
            <stop offset="18%" stop-color="#ffe056" />
            <stop offset="42%" stop-color="#f0c010" />
            <stop offset="58%" stop-color="#d9a40a" />
            <stop offset="100%" stop-color="#a87808" />
          </linearGradient>
          <linearGradient id={pencilEraser} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffc1ce" />
            <stop offset="40%" stop-color="#f07088" />
            <stop offset="100%" stop-color="#c43a58" />
          </linearGradient>
          <linearGradient id={pencilFerrule} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f7f7f4" />
            <stop offset="35%" stop-color="#d2d0c6" />
            <stop offset="100%" stop-color="#8a8678" />
          </linearGradient>
          <linearGradient id={pencilCone} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f8ead0" />
            <stop offset="45%" stop-color="#e2c392" />
            <stop offset="100%" stop-color="#b08950" />
          </linearGradient>
          <linearGradient id={pencilLead} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#6a6a70" />
            <stop offset="55%" stop-color="#3a3a40" />
            <stop offset="100%" stop-color="#1c1c20" />
          </linearGradient>
          <linearGradient id={brushHandle} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#d4a06a" />
            <stop offset="28%" stop-color="#a86a38" />
            <stop offset="62%" stop-color="#7a441c" />
            <stop offset="100%" stop-color="#4e2a10" />
          </linearGradient>
          <linearGradient id={brushFerrule} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="30%" stop-color="#d0d4dc" />
            <stop offset="100%" stop-color="#6e7480" />
          </linearGradient>
          <linearGradient id={brushHair} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#c48a4a" />
            <stop offset="32%" stop-color="#8a4e22" />
            <stop offset="70%" stop-color="#5a2e10" />
            <stop offset="100%" stop-color="#3a1a08" />
          </linearGradient>
          <linearGradient id={rulerFace} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f7e7bc" />
            <stop offset="38%" stop-color="#e2c37a" />
            <stop offset="100%" stop-color="#b48a42" />
          </linearGradient>
          <linearGradient id={rulerSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8a6230" />
            <stop offset="100%" stop-color="#5a3c18" />
          </linearGradient>
        </defs>

        <g filter={`url(#${shadow})`}>
          <g transform={BRUSH_TF}>
            <path d={BRUSH_SILHOUETTE} fill="#000" />
          </g>
          <g transform={PENCIL_TF}>
            <path d={PENCIL_SILHOUETTE} fill="#000" />
          </g>
          <g transform={RULER_TF}>
            <path d={RULER_PATH} fill="#000" />
          </g>
        </g>

        {/* 侧壁：世界坐标下移，读出厚度 */}
        <g transform="translate(0.95 1.55)" opacity="0.9">
          <g transform={BRUSH_TF}>
            <path d={BRUSH_SILHOUETTE} fill="#3a2412" />
          </g>
          <g transform={PENCIL_TF}>
            <path d={PENCIL_SILHOUETTE} fill="#7a5a08" />
          </g>
          <g transform={RULER_TF}>
            <path d={RULER_PATH} fill={`url(#${rulerSide})`} />
          </g>
        </g>

        <g transform={BRUSH_TF}>
          <path d={BRUSH_SILHOUETTE} fill={`url(#${brushHandle})`} />
          <path
            d="M 24.7 -3.15 L 30.15 -3.15 L 30.15 3.15 L 24.7 3.15 Z"
            fill={`url(#${brushFerrule})`}
            stroke="rgba(30,30,36,0.28)"
            stroke-width="0.35"
          />
          <line x1="26.15" y1="-3.05" x2="26.15" y2="3.05" stroke="rgba(0,0,0,0.22)" stroke-width="0.45" />
          <line x1="28.55" y1="-3.05" x2="28.55" y2="3.05" stroke="rgba(0,0,0,0.2)" stroke-width="0.45" />
          <line x1="25.35" y1="-2.7" x2="29.5" y2="-2.7" stroke="rgba(255,255,255,0.55)" stroke-width="0.55" />
          <path
            d="M 30.05 -3.05 C 34.7 -3.8 38.35 -2.3 41.45 0 C 38.35 2.3 34.7 3.8 30.05 3.05 Z"
            fill={`url(#${brushHair})`}
          />
          <path
            d="M 30.2 0.15 C 34.5 0.9 37.8 1.15 41.15 0 C 38.2 2.15 34.6 3.45 30.2 2.85 Z"
            fill="rgba(30,12,4,0.28)"
          />
          <path
            d="M 30.25 -2.75 C 34.4 -3.35 37.7 -2.05 40.6 -0.35"
            fill="none"
            stroke="rgba(255,220,170,0.38)"
            stroke-width="0.7"
            stroke-linecap="round"
          />
          <path
            d="M 30.4 -1.55 C 34.3 -1.95 37.5 -1.05 40.35 0"
            fill="none"
            stroke="rgba(60,24,6,0.4)"
            stroke-width="0.4"
            stroke-linecap="round"
          />
          <path
            d="M 30.35 0.15 C 34.5 0.35 37.7 0.4 40.55 0"
            fill="none"
            stroke="rgba(30,10,2,0.38)"
            stroke-width="0.4"
            stroke-linecap="round"
          />
          <path
            d="M 30.4 1.7 C 34.3 2.1 37.5 1.15 40.35 0"
            fill="none"
            stroke="rgba(20,8,2,0.42)"
            stroke-width="0.4"
            stroke-linecap="round"
          />
          <path
            d="M 2.4 -1.45 L 24.5 -1.95"
            fill="none"
            stroke="rgba(255,230,190,0.34)"
            stroke-width="0.85"
            stroke-linecap="round"
          />
          <ellipse cx="0.95" cy="0" rx="0.55" ry="1.85" fill="rgba(40,20,8,0.45)" />
        </g>

        <g transform={PENCIL_TF}>
          <path d={PENCIL_SILHOUETTE} fill={`url(#${pencilBody})`} />
          <path
            d="M 0.15 -2.35 A 1.05 1.05 0 0 1 1.2 -3.4 H 4.55 V 3.4 H 1.2 A 1.05 1.05 0 0 1 0.15 2.35 Z"
            fill={`url(#${pencilEraser})`}
          />
          <ellipse cx="1.35" cy="-1.35" rx="1.05" ry="0.7" fill="rgba(255,255,255,0.4)" />
          <rect x="4.45" y="-3.55" width="3.55" height="7.1" fill={`url(#${pencilFerrule})`} />
          <line x1="5.2" y1="-3.45" x2="5.2" y2="3.45" stroke="rgba(0,0,0,0.18)" stroke-width="0.4" />
          <line x1="7.15" y1="-3.45" x2="7.15" y2="3.45" stroke="rgba(0,0,0,0.16)" stroke-width="0.4" />
          <line x1="4.7" y1="-2.85" x2="7.7" y2="-2.85" stroke="rgba(255,255,255,0.55)" stroke-width="0.5" />
          <path
            d="M 8.0 -3.2 H 32.35 V -0.85 H 8.0 Z"
            fill="rgba(255,255,255,0.22)"
          />
          <path
            d="M 8.0 1.35 H 32.35 V 3.35 H 8.0 Z"
            fill="rgba(90,50,0,0.18)"
          />
          <path
            d="M 32.15 -3.5 L 37.35 -1.15 L 37.35 1.15 L 32.15 3.5 Z"
            fill={`url(#${pencilCone})`}
          />
          <path
            d="M 32.15 -3.5 L 37.35 -1.15 L 32.15 -0.35 Z"
            fill="rgba(255,255,255,0.28)"
          />
          <path d="M 37.2 -1.2 L 41.5 0 L 37.2 1.2 Z" fill={`url(#${pencilLead})`} />
          <path d="M 37.2 -1.2 L 41.5 0 L 37.2 -0.15 Z" fill="rgba(255,255,255,0.22)" />
        </g>

        <g transform="translate(0.7 1.25)">
          <g transform={RULER_TF}>
            <path d={RULER_PATH} fill={`url(#${rulerSide})`} />
          </g>
        </g>
        <g transform={RULER_TF}>
          <path
            d={RULER_PATH}
            fill={`url(#${rulerFace})`}
            stroke="rgba(70,42,10,0.35)"
            stroke-width="0.45"
          />
          <rect x="-13.6" y="-2.85" width="27.2" height="1.35" rx="0.4" fill="rgba(255,255,255,0.32)" />
          <rect x="-13.6" y="1.55" width="27.2" height="1.2" rx="0.35" fill="rgba(90,50,10,0.16)" />
          {RULER_TICKS.map((x, i) => {
            const major = i % 2 === 0
            const y2 = major ? 1.35 : 0.35
            return (
              <line
                key={x}
                x1={x}
                y1="-2.55"
                x2={x}
                y2={y2}
                stroke="rgba(70,42,12,0.72)"
                stroke-width={major ? 0.55 : 0.4}
                stroke-linecap="round"
              />
            )
          })}
          <circle cx="-11.55" cy="0" r="1.45" fill="#0b5cbc" />
          <circle cx="-11.55" cy="0" r="1.45" fill="none" stroke="rgba(40,20,0,0.35)" stroke-width="0.4" />
          <circle cx="-11.25" cy="-0.35" r="0.7" fill="rgba(255,255,255,0.18)" />
        </g>
      </svg>
    </AppIconTile>
  )
}
