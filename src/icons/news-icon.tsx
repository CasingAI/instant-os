import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `news-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

const PAPER = { x: 7.05, y: 13.1, w: 45, h: 37.45, r: 1.5 }

/** 封面缺掉右上折角，露出内页。 */
const FACE_PATH = [
  'M 8.55 13.1',
  'H 42.15',
  'L 52.05 22.95',
  'V 49.05',
  'A 1.5 1.5 0 0 1 50.55 50.55',
  'H 8.55',
  'A 1.5 1.5 0 0 1 7.05 49.05',
  'V 14.6',
  'A 1.5 1.5 0 0 1 8.55 13.1',
  'Z',
].join(' ')

const PHOTO_LINES = [
  { y: 25.85, w: 16.0 },
  { y: 27.75, w: 14.7 },
  { y: 29.65, w: 15.6 },
  { y: 31.55, w: 13.1 },
  { y: 33.45, w: 15.2 },
  { y: 35.35, w: 11.2 },
] as const

const LEFT_COL = [
  { y: 38.15, w: 19.1 },
  { y: 39.9, w: 17.4 },
  { y: 41.65, w: 18.5 },
  { y: 43.4, w: 15.8 },
  { y: 45.15, w: 17.7 },
  { y: 46.9, w: 12.8 },
] as const

const RIGHT_COL = [
  { y: 38.15, w: 18.9 },
  { y: 39.9, w: 17.0 },
  { y: 41.65, w: 18.3 },
  { y: 43.4, w: 15.4 },
  { y: 45.15, w: 17.4 },
  { y: 46.9, w: 12.0 },
] as const

const SHEETS = [
  { dx: 2.35, dy: 3.05, fill: 'side' },
  { dx: 1.75, dy: 2.28, fill: '#c9ab7a', edge: 'rgba(255,248,230,0.55)', edgeW: 0.55 },
  { dx: 1.15, dy: 1.5, fill: 'sheetB', edge: 'rgba(255,252,240,0.7)', edgeW: 0.7 },
  { dx: 0.55, dy: 0.72, fill: 'sheetA', edge: 'rgba(255,255,248,0.82)', edgeW: 0.85 },
] as const

/**
 * 折起的报纸：叠页厚度、红报头、折角与中缝，让 📰 读成立体物件。
 */
export function NewsIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const pageFace = svgUid(rawId, 'page-face')
  const pageSide = svgUid(rawId, 'page-side')
  const sheetA = svgUid(rawId, 'sheet-a')
  const sheetB = svgUid(rawId, 'sheet-b')
  const masthead = svgUid(rawId, 'masthead')
  const photoSky = svgUid(rawId, 'photo-sky')
  const flap = svgUid(rawId, 'flap')
  const faceClip = svgUid(rawId, 'face-clip')

  const sheetFill = (fill: (typeof SHEETS)[number]['fill']) => {
    if (fill === 'side') return `url(#${pageSide})`
    if (fill === 'sheetA') return `url(#${sheetA})`
    if (fill === 'sheetB') return `url(#${sheetB})`
    return fill
  }

  return (
    <AppIconTile color="#c43c2e" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.35" result="blur" />
            <feOffset dx="0.8" dy="1.8" result="off" />
            <feFlood flood-color="#3a0c08" flood-opacity="0.55" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={pageFace} x1="0.08" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stop-color="#fffdf6" />
            <stop offset="42%" stop-color="#f3e6cc" />
            <stop offset="100%" stop-color="#d7bc90" />
          </linearGradient>
          <linearGradient id={pageSide} x1="0" y1="0" x2="1" y2="0.15">
            <stop offset="0%" stop-color="#d8bf96" />
            <stop offset="55%" stop-color="#b89464" />
            <stop offset="100%" stop-color="#8a6238" />
          </linearGradient>
          <linearGradient id={sheetA} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f3e4c8" />
            <stop offset="100%" stop-color="#d2b484" />
          </linearGradient>
          <linearGradient id={sheetB} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#e6d3ae" />
            <stop offset="100%" stop-color="#c4a474" />
          </linearGradient>
          <linearGradient id={masthead} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f06a5c" />
            <stop offset="42%" stop-color="#c43c2e" />
            <stop offset="100%" stop-color="#8a2018" />
          </linearGradient>
          <linearGradient id={photoSky} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#9bb6ce" />
            <stop offset="58%" stop-color="#5d7a94" />
            <stop offset="100%" stop-color="#33485c" />
          </linearGradient>
          <linearGradient id={flap} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#fff6e4" />
            <stop offset="45%" stop-color="#ead6b0" />
            <stop offset="100%" stop-color="#c4a878" />
          </linearGradient>
          <clipPath id={faceClip}>
            <path d={FACE_PATH} />
          </clipPath>
        </defs>

        <g transform="translate(32 33.1) rotate(-8) translate(-30.8 -32.1)">
          <g filter={`url(#${shadow})`}>
            <rect x={PAPER.x} y={PAPER.y} width={PAPER.w} height={PAPER.h} rx={PAPER.r} fill="#000" />
          </g>

          {SHEETS.map((sheet) => (
            <g key={sheet.dx} transform={`translate(${sheet.dx} ${sheet.dy})`}>
              <rect
                x={PAPER.x}
                y={PAPER.y}
                width={PAPER.w}
                height={PAPER.h}
                rx={PAPER.r}
                fill={sheetFill(sheet.fill)}
              />
              {'edge' in sheet && sheet.edge ? (
                <rect x="50.5" y="14.4" width={sheet.edgeW} height="34.8" fill={sheet.edge} />
              ) : null}
            </g>
          ))}

          <path
            d={FACE_PATH}
            fill={`url(#${pageFace})`}
            stroke="rgba(80,52,22,0.32)"
            stroke-width="0.5"
          />
          <path d="M 42.15 13.1 H 52.05 V 22.95 Z" fill="#e2cc9e" />

          <g clip-path={`url(#${faceClip})`}>
            <rect x="7.2" y="13.2" width="35" height="3.4" rx="0.7" fill="rgba(255,255,255,0.46)" />
            <rect x="7.2" y="47.4" width="44.6" height="3.2" fill="rgba(110,72,28,0.13)" />

            <rect x="9.15" y="15.55" width="31.5" height="7.55" rx="0.75" fill="#6e1812" />
            <rect x="9.05" y="15.2" width="31.5" height="7.55" rx="0.75" fill={`url(#${masthead})`} />
            <rect x="9.35" y="15.4" width="30.9" height="1.45" rx="0.45" fill="rgba(255,255,255,0.3)" />
            <rect x="9.7" y="16.7" width="30.2" height="0.38" fill="rgba(255,228,176,0.5)" />
            <rect x="9.7" y="21.55" width="30.2" height="0.38" fill="rgba(70,8,6,0.38)" />
            <text
              x="24.8"
              y="21.05"
              text-anchor="middle"
              fill="#fffdf8"
              font-family="Georgia, 'Times New Roman', serif"
              font-size="4.85"
              font-weight="700"
              letter-spacing="1.2"
            >
              NEWS
            </text>

            <rect x="9.2" y="23.7" width="21.2" height="0.72" rx="0.3" fill="rgba(70,48,22,0.4)" />
            <rect x="31.2" y="23.7" width="9.4" height="0.72" rx="0.3" fill="rgba(70,48,22,0.22)" />

            <rect x="9.1" y="25.75" width="14.15" height="10.85" rx="0.6" fill={`url(#${photoSky})`} />
            <path
              d="M 9.1 33.5 L 14.05 29.7 L 17.45 32.0 L 20.85 28.15 L 23.25 31.15 V 36.6 H 9.1 Z"
              fill="#2a3f52"
            />
            <circle cx="20.95" cy="28.05" r="1.2" fill="#f2e4bc" />
            <rect x="9.1" y="25.75" width="14.15" height="2.15" rx="0.45" fill="rgba(255,255,255,0.2)" />
            <rect
              x="9.1"
              y="25.75"
              width="14.15"
              height="10.85"
              rx="0.6"
              fill="none"
              stroke="rgba(40,26,10,0.3)"
              stroke-width="0.42"
            />

            <g fill="rgba(58,40,18,0.5)">
              {PHOTO_LINES.map((line) => (
                <rect key={line.y} x="24.7" y={line.y} width={line.w} height="1.18" rx="0.48" />
              ))}
            </g>
            <g fill="rgba(58,40,18,0.4)">
              {LEFT_COL.map((line) => (
                <rect key={`l-${line.y}`} x="9.1" y={line.y} width={line.w} height="1.08" rx="0.42" />
              ))}
              {RIGHT_COL.map((line) => (
                <rect key={`r-${line.y}`} x="30.5" y={line.y} width={line.w} height="1.08" rx="0.42" />
              ))}
            </g>

            <rect x="28.85" y="23.4" width="1.55" height="27.0" fill="rgba(90,58,24,0.11)" />
            <line
              x1="29.7"
              y1="23.2"
              x2="29.7"
              y2="50.4"
              stroke="rgba(70,46,18,0.26)"
              stroke-width="0.5"
            />
            <line
              x1="29.15"
              y1="23.2"
              x2="29.15"
              y2="50.4"
              stroke="rgba(255,255,255,0.32)"
              stroke-width="0.42"
            />
          </g>

          <path d="M 42.15 13.1 L 52.05 22.95 L 42.2 22.9 Z" fill={`url(#${flap})`} />
          <path
            d="M 42.15 13.1 L 52.05 22.95 L 42.2 22.9 Z"
            fill="none"
            stroke="rgba(80,52,22,0.42)"
            stroke-width="0.45"
            stroke-linejoin="round"
          />
          <path
            d="M 42.9 14.05 L 50.15 21.95"
            fill="none"
            stroke="rgba(255,255,255,0.42)"
            stroke-width="0.6"
            stroke-linecap="round"
          />
          <path
            d="M 42.2 22.9 L 52.05 22.95"
            fill="none"
            stroke="rgba(90,58,24,0.28)"
            stroke-width="0.4"
          />
          <path d="M 42.3 22.9 L 51.7 22.95 L 42.35 24.05 Z" fill="rgba(70,46,18,0.16)" />
        </g>
      </svg>
    </AppIconTile>
  )
}
