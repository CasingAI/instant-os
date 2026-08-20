import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `pages-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

const PAGE = { x: -15.2, y: -22.6, w: 30.4, h: 45.2, fold: 9.4 }

const PAGE_FACE = [
  `M ${PAGE.x} ${PAGE.y}`,
  `H ${PAGE.x + PAGE.w - PAGE.fold}`,
  `L ${PAGE.x + PAGE.w} ${PAGE.y + PAGE.fold}`,
  `V ${PAGE.y + PAGE.h}`,
  `H ${PAGE.x}`,
  'Z',
].join(' ')

const PAGE_OUTER = [
  `M ${PAGE.x} ${PAGE.y}`,
  `H ${PAGE.x + PAGE.w}`,
  `V ${PAGE.y + PAGE.h}`,
  `H ${PAGE.x}`,
  'Z',
].join(' ')

const PAGE_FOLD = [
  `M ${PAGE.x + PAGE.w - PAGE.fold} ${PAGE.y}`,
  `L ${PAGE.x + PAGE.w} ${PAGE.y + PAGE.fold}`,
  `L ${PAGE.x + PAGE.w - PAGE.fold} ${PAGE.y + PAGE.fold}`,
  'Z',
].join(' ')

const PEN_TF = 'translate(-12.2 12.6) rotate(-33)'

const PEN_SILHOUETTE = [
  'M 1.1 -1.5',
  'H 24.5',
  'L 33.2 0',
  'L 24.5 1.5',
  'H 1.1',
  'A 1.1 1.1 0 0 1 0 0.4',
  'V -0.4',
  'A 1.1 1.1 0 0 1 1.1 -1.5',
  'Z',
].join(' ')

const TEXT_LINES: { x: number; y: number; w: number; h: number; title?: boolean }[] = [
  { x: -11.4, y: -16.4, w: 14.4, h: 1.9, title: true },
  { x: -11.4, y: -12.2, w: 20.4, h: 1.35 },
  { x: -11.4, y: -8.9, w: 18.2, h: 1.35 },
  { x: -11.4, y: -5.6, w: 20.8, h: 1.35 },
  { x: -11.4, y: -2.3, w: 13.2, h: 1.35 },
  { x: -11.4, y: 1.0, w: 19.0, h: 1.35 },
  { x: -11.4, y: 4.3, w: 16.4, h: 1.35 },
]

/**
 * iWork 文稿：微倾的纸页（折角、厚度、排版行）+ 斜搁的金尖钢笔。
 */
export function PagesIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const paperFace = svgUid(rawId, 'paper-face')
  const paperBack = svgUid(rawId, 'paper-back')
  const paperSide = svgUid(rawId, 'paper-side')
  const foldFace = svgUid(rawId, 'fold-face')
  const barrel = svgUid(rawId, 'barrel')
  const gold = svgUid(rawId, 'gold')
  const nib = svgUid(rawId, 'nib')

  return (
    <AppIconTile color="#2f6fed" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="170%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.35" result="blur" />
            <feOffset dx="0.6" dy="1.7" result="off" />
            <feFlood flood-color="#08245a" flood-opacity="0.48" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={paperFace} x1="0" y1="0" x2="0.18" y2="1">
            <stop offset="0%" stop-color="#fffef8" />
            <stop offset="42%" stop-color="#f6f1e6" />
            <stop offset="100%" stop-color="#e7dcc8" />
          </linearGradient>
          <linearGradient id={paperBack} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f0e9da" />
            <stop offset="100%" stop-color="#ddd2bc" />
          </linearGradient>
          <linearGradient id={paperSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#c8b898" />
            <stop offset="100%" stop-color="#8a7a5c" />
          </linearGradient>
          <linearGradient id={foldFace} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f3ead8" />
            <stop offset="100%" stop-color="#d2c2a4" />
          </linearGradient>
          <linearGradient id={barrel} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6a6a72" />
            <stop offset="28%" stop-color="#2c2c32" />
            <stop offset="62%" stop-color="#141418" />
            <stop offset="100%" stop-color="#050506" />
          </linearGradient>
          <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff3c4" />
            <stop offset="38%" stop-color="#e0b445" />
            <stop offset="100%" stop-color="#8a6414" />
          </linearGradient>
          <linearGradient id={nib} x1="0" y1="0" x2="1" y2="0.4">
            <stop offset="0%" stop-color="#fff0b0" />
            <stop offset="45%" stop-color="#e2b84a" />
            <stop offset="100%" stop-color="#7a5a12" />
          </linearGradient>
        </defs>

        <g transform="translate(32 32.2) rotate(-8)">
          <g filter={`url(#${shadow})`}>
            <path d={PAGE_OUTER} fill="#000" transform="translate(1.6 2.1)" />
            <g transform={PEN_TF}>
              <path d={PEN_SILHOUETTE} fill="#000" />
            </g>
          </g>

          <path d={PAGE_OUTER} fill={`url(#${paperSide})`} transform="translate(0.95 1.25)" />
          <path d={PAGE_OUTER} fill={`url(#${paperBack})`} transform="translate(1.15 1.4)" />

          <path d={PAGE_OUTER} fill={`url(#${paperSide})`} transform="translate(0.7 0.95)" />
          <path d={PAGE_FACE} fill={`url(#${paperFace})`} />
          <path
            d={PAGE_FACE}
            fill="none"
            stroke="rgba(90,70,40,0.22)"
            stroke-width="0.45"
          />
          <path d={PAGE_FOLD} fill={`url(#${foldFace})`} />
          <path
            d={`M ${PAGE.x + PAGE.w - PAGE.fold} ${PAGE.y} L ${PAGE.x + PAGE.w} ${PAGE.y + PAGE.fold}`}
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            stroke-width="0.55"
            stroke-linecap="round"
          />
          <path
            d={`M ${PAGE.x + PAGE.w - PAGE.fold} ${PAGE.y + 0.35} L ${PAGE.x + PAGE.w - PAGE.fold} ${PAGE.y + PAGE.fold} L ${PAGE.x + PAGE.w - 0.35} ${PAGE.y + PAGE.fold}`}
            fill="none"
            stroke="rgba(90,70,40,0.28)"
            stroke-width="0.45"
            stroke-linecap="round"
            stroke-linejoin="round"
          />

          <rect
            x={PAGE.x + 0.8}
            y={PAGE.y + 0.6}
            width={PAGE.w - PAGE.fold - 1.4}
            height="2.4"
            fill="rgba(255,255,255,0.55)"
          />
          {TEXT_LINES.map((line) => (
            <rect
              key={`${line.x}-${line.y}`}
              x={line.x}
              y={line.y}
              width={line.w}
              height={line.h}
              rx={0.45}
              fill={line.title ? '#2a3348' : 'rgba(52, 60, 78, 0.55)'}
            />
          ))}
          <g transform={PEN_TF}>
            <path d={PEN_SILHOUETTE} fill="#3a2a10" opacity="0.28" transform="translate(0.45 0.85)" />
          </g>

          <g transform={PEN_TF}>
            <path d={PEN_SILHOUETTE} fill="#1a1208" transform="translate(0.5 0.85)" />
            <path d={PEN_SILHOUETTE} fill={`url(#${barrel})`} />
            <rect x="18.8" y="-1.55" width="1.85" height="3.1" fill={`url(#${gold})`} />
            <rect x="21.7" y="-1.45" width="2.35" height="2.9" rx="0.22" fill={`url(#${gold})`} />
            <line x1="19.3" y1="-1.5" x2="19.3" y2="1.5" stroke="rgba(80,50,0,0.35)" stroke-width="0.28" />
            <line x1="20.2" y1="-1.5" x2="20.2" y2="1.5" stroke="rgba(255,240,180,0.4)" stroke-width="0.28" />
            <path
              d="M 1.35 -1.0 H 18.5"
              fill="none"
              stroke="rgba(255,255,255,0.28)"
              stroke-width="0.65"
              stroke-linecap="round"
            />
            <path
              d="M 3.9 -2.75 L 10.6 -2.75 C 11.1 -2.75 11.4 -2.4 11.4 -2.05 V -1.5 H 10.15 V -2.0 H 4.7 C 4.2 -2.5 3.9 -2.6 3.9 -2.75 Z"
              fill={`url(#${gold})`}
            />
            <path
              d="M 23.9 -1.5 C 26.9 -2.25 30.2 -1.45 33.2 0 C 30.2 1.45 26.9 2.25 23.9 1.5 Z"
              fill={`url(#${nib})`}
            />
            <circle cx="25.55" cy="0" r="0.5" fill="#5a4010" />
            <circle cx="25.55" cy="0" r="0.24" fill="#f0d078" />
            <line
              x1="26.05"
              y1="0"
              x2="33.05"
              y2="0"
              stroke="rgba(60,40,8,0.7)"
              stroke-width="0.36"
              stroke-linecap="round"
            />
            <path
              d="M 24.1 -1.1 C 26.8 -1.6 29.9 -1.0 32.4 -0.2"
              fill="none"
              stroke="rgba(255,245,200,0.45)"
              stroke-width="0.42"
              stroke-linecap="round"
            />
          </g>
        </g>
      </svg>
    </AppIconTile>
  )
}
