import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `textedit-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
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

const PAPER_BACK_TF = 'translate(31.6 34.4) rotate(-2.5)'
const PAPER_TF = 'translate(29.8 32.8) rotate(-8)'
const PEN_TF = 'translate(45.4 49.8) rotate(-123)'

const PAPER_PATH = roundedRectPath(-17.2, -22.4, 34.4, 44.8, 1.35)

/** 沿局部 +x：笔杆圆头 → 金箍 → 握位 → 笔尖。 */
const PEN_SILHOUETTE = [
  'M 1.65 -1.95',
  'A 1.65 1.95 0 0 0 1.65 1.95',
  'L 23.6 2.05',
  'L 29.4 1.55',
  'L 30.8 1.75',
  'L 34.8 2.45',
  'L 38.7 0',
  'L 34.8 -2.45',
  'L 30.8 -1.75',
  'L 29.4 -1.55',
  'L 23.6 -2.05',
  'Z',
].join(' ')

const PAPER_LINES = [-13.2, -8.1, -3.0, 2.1, 7.2, 12.3, 17.4] as const

const TEXT_ROWS = [
  { y: -13.2, w: 18.5 },
  { y: -8.1, w: 21.2 },
  { y: -3.0, w: 12.4 },
  { y: 2.1, w: 19.8 },
  { y: 7.2, w: 8.6 },
] as const

/**
 * macOS 文本编辑：稿纸叠层 + 黑漆金尖钢笔。
 * 纸有侧壁与红栏蓝线，笔有圆柱高光和经典笔尖，避免再落回 emoji。
 */
export function TextEditIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const paperFace = svgUid(rawId, 'paper-face')
  const paperSide = svgUid(rawId, 'paper-side')
  const paperBack = svgUid(rawId, 'paper-back')
  const barrel = svgUid(rawId, 'barrel')
  const gold = svgUid(rawId, 'gold')
  const nib = svgUid(rawId, 'nib')

  return (
    <AppIconTile color="#c4a882" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="170%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="blur" />
            <feOffset dx="0.6" dy="1.5" result="off" />
            <feFlood flood-color="#3a2a14" flood-opacity="0.42" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={paperBack} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#e6d3b0" />
            <stop offset="100%" stop-color="#c8ae80" />
          </linearGradient>
          <linearGradient id={paperSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#cbb896" />
            <stop offset="100%" stop-color="#8a7350" />
          </linearGradient>
          <linearGradient id={paperFace} x1="0" y1="0" x2="0.15" y2="1">
            <stop offset="0%" stop-color="#fffcf6" />
            <stop offset="45%" stop-color="#f6f0e4" />
            <stop offset="100%" stop-color="#e4d6be" />
          </linearGradient>
          <linearGradient id={barrel} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6a6a72" />
            <stop offset="22%" stop-color="#2c2c32" />
            <stop offset="52%" stop-color="#141418" />
            <stop offset="100%" stop-color="#050506" />
          </linearGradient>
          <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff3c0" />
            <stop offset="35%" stop-color="#e4c056" />
            <stop offset="100%" stop-color="#9a7018" />
          </linearGradient>
          <linearGradient id={nib} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffe9a0" />
            <stop offset="40%" stop-color="#e0b84a" />
            <stop offset="100%" stop-color="#8a5a10" />
          </linearGradient>
        </defs>

        <g filter={`url(#${shadow})`}>
          <g transform={PAPER_BACK_TF}>
            <path d={PAPER_PATH} fill="#000" />
          </g>
          <g transform={PAPER_TF}>
            <path d={PAPER_PATH} fill="#000" />
          </g>
        </g>

        <g transform="translate(1.05 1.7)">
          <g transform={PAPER_BACK_TF}>
            <path d={PAPER_PATH} fill={`url(#${paperSide})`} />
          </g>
        </g>
        <g transform={PAPER_BACK_TF}>
          <path d={PAPER_PATH} fill={`url(#${paperBack})`} />
        </g>

        <g transform="translate(0.85 1.45)">
          <g transform={PAPER_TF}>
            <path d={PAPER_PATH} fill={`url(#${paperSide})`} />
          </g>
        </g>
        <g transform={PAPER_TF}>
          <path
            d={PAPER_PATH}
            fill={`url(#${paperFace})`}
            stroke="rgba(90,70,40,0.22)"
            stroke-width="0.4"
          />
          <rect x="-15.6" y="-21.2" width="31.2" height="3.2" rx="0.6" fill="rgba(255,255,255,0.45)" />
          <line
            x1="-10.4"
            y1="-20.4"
            x2="-10.4"
            y2="20.6"
            stroke="#d45a5a"
            stroke-width="0.7"
            opacity="0.8"
          />
          {PAPER_LINES.map((y) => (
            <line
              key={y}
              x1="-15.4"
              y1={y}
              x2="15.4"
              y2={y}
              stroke="#b7c8dc"
              stroke-width="0.45"
            />
          ))}
          {TEXT_ROWS.map((row) => (
            <rect
              key={row.y}
              x="-8.2"
              y={row.y - 0.7}
              width={row.w}
              height="1.15"
              rx="0.55"
              fill="#4a453e"
              opacity="0.58"
            />
          ))}
        </g>

        <g filter={`url(#${shadow})`}>
          <g transform={PEN_TF}>
            <path d={PEN_SILHOUETTE} fill="#000" />
          </g>
        </g>
        <g transform="translate(0.9 1.5)">
          <g transform={PEN_TF}>
            <path d={PEN_SILHOUETTE} fill="#1a1208" />
          </g>
        </g>

        <g transform={PEN_TF}>
          <path d={PEN_SILHOUETTE} fill={`url(#${barrel})`} />
          <path
            d="M 1.7 -1.15 L 23.4 -1.25"
            fill="none"
            stroke="rgba(255,255,255,0.28)"
            stroke-width="0.7"
            stroke-linecap="round"
          />
          <rect x="22.55" y="-2.1" width="2.55" height="4.2" fill={`url(#${gold})`} />
          <line x1="23.15" y1="-2.0" x2="23.15" y2="2.0" stroke="rgba(80,50,10,0.35)" stroke-width="0.35" />
          <line x1="24.5" y1="-2.0" x2="24.5" y2="2.0" stroke="rgba(255,240,180,0.45)" stroke-width="0.35" />
          <path
            d="M 25.1 -1.95 L 29.35 -1.5 L 29.35 1.5 L 25.1 1.95 Z"
            fill="#1c1c22"
          />
          <path
            d="M 25.2 -0.95 L 29.2 -0.7"
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            stroke-width="0.45"
            stroke-linecap="round"
          />
          <path
            d="M 29.4 -1.55 L 30.85 -1.75 L 34.85 -2.45 L 38.7 0 L 34.85 2.45 L 30.85 1.75 L 29.4 1.55 Z"
            fill={`url(#${nib})`}
            stroke="rgba(90,55,8,0.4)"
            stroke-width="0.3"
          />
          <path
            d="M 30.2 -1.35 L 34.4 -1.85 L 37.6 0 L 34.4 -0.15 L 30.2 -0.15 Z"
            fill="rgba(255,245,200,0.38)"
          />
          <circle cx="32.15" cy="0" r="0.7" fill="#6a4a10" />
          <circle cx="32.15" cy="0" r="0.38" fill="#1a1208" />
          <line
            x1="32.15"
            y1="0"
            x2="38.55"
            y2="0"
            stroke="#4a3208"
            stroke-width="0.4"
            stroke-linecap="round"
          />
          <path d="M 37.7 -0.28 L 38.7 0 L 37.7 0.28 Z" fill="#2a2218" />
        </g>
      </svg>
    </AppIconTile>
  )
}
