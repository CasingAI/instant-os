import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `event-log-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

const GROUP_TF = 'translate(32 33.1) rotate(-6.5) translate(-32 -33.1)'

/** 封面：微斜平行四边形，右上略抬。 */
const COVER_FACE = [
  'M 14.35 11.55',
  'L 44.55 9.85',
  'A 1.7 1.7 0 0 1 46.35 11.5',
  'L 47.85 48.35',
  'A 1.7 1.7 0 0 1 46.15 50.2',
  'L 14.55 51.85',
  'A 1.15 1.15 0 0 1 13.4 50.7',
  'L 13.15 12.75',
  'A 1.15 1.15 0 0 1 14.35 11.55',
  'Z',
].join(' ')

/** 书脊：左侧半圆筒，单侧外鼓。 */
const SPINE = [
  'M 14.35 11.55',
  'C 8.05 13.45 7.85 49.35 13.4 50.7',
  'L 14.55 51.85',
  'L 13.4 50.7',
  'L 13.15 12.75',
  'Z',
].join(' ')

/** 切口：右侧纸叠。 */
const FORE_EDGE = [
  'M 46.35 11.5',
  'L 53.55 14.15',
  'A 1.35 1.35 0 0 1 54.85 15.55',
  'L 56.15 51.05',
  'A 1.35 1.35 0 0 1 54.75 52.55',
  'L 47.85 50.2',
  'A 1.7 1.7 0 0 0 46.15 48.35',
  'Z',
].join(' ')

/** 书顶纸口：一叠纸的上沿。 */
const PAGE_TOP = [
  'M 44.55 9.85',
  'L 51.65 12.35',
  'L 53.55 14.15',
  'L 46.35 11.5',
  'A 1.7 1.7 0 0 0 44.55 9.85',
  'Z',
].join(' ')

const BOTTOM = [
  'M 14.55 51.85',
  'L 46.15 50.2',
  'L 47.85 50.2',
  'L 54.75 52.55',
  'L 22.85 54.55',
  'A 1.2 1.2 0 0 1 21.55 53.55',
  'Z',
].join(' ')

const GOLD_BORDER = [
  'M 17.15 14.85',
  'L 43.05 13.35',
  'A 0.85 0.85 0 0 1 43.95 14.2',
  'L 45.25 46.55',
  'A 0.85 0.85 0 0 1 44.4 47.5',
  'L 17.55 48.85',
  'A 0.85 0.85 0 0 1 16.65 47.95',
  'L 16.35 15.75',
  'A 0.85 0.85 0 0 1 17.15 14.85',
  'Z',
].join(' ')

const RIBBON = [
  'M 43.85 10.25',
  'C 43.55 6.55 48.55 6.35 48.85 10.15',
  'L 49.65 21.45',
  'L 47.05 20.25',
  'L 46.25 26.35',
  'L 44.35 20.45',
  'L 41.75 21.35',
  'Z',
].join(' ')

const RIBBON_SHADOW = [
  'M 44.15 10.55',
  'C 43.95 7.15 48.65 6.95 48.95 10.45',
  'L 49.85 21.95',
  'L 47.25 20.75',
  'L 46.45 26.95',
  'L 44.55 20.95',
  'L 41.95 21.85',
  'Z',
].join(' ')

const PAGE_STRIPES = [47.15, 48.05, 48.95, 49.85, 50.75, 51.65, 52.55, 53.45] as const

/**
 * 皮面日志本：书脊、金边、切口纸叠和珐琅勾章，让「事件日志」读成立体物件。
 */
export function EventLogIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const spineFace = svgUid(rawId, 'spine')
  const coverFace = svgUid(rawId, 'cover')
  const coverSide = svgUid(rawId, 'cover-side')
  const leatherShade = svgUid(rawId, 'leather-shade')
  const gold = svgUid(rawId, 'gold')
  const goldEdge = svgUid(rawId, 'gold-edge')
  const plate = svgUid(rawId, 'plate')
  const pages = svgUid(rawId, 'pages')
  const pageTop = svgUid(rawId, 'page-top')
  const pageSide = svgUid(rawId, 'page-side')
  const ribbon = svgUid(rawId, 'ribbon')
  const enamel = svgUid(rawId, 'enamel')
  const ring = svgUid(rawId, 'ring')
  const spineClip = svgUid(rawId, 'spine-clip')
  const coverClip = svgUid(rawId, 'cover-clip')

  return (
    <AppIconTile color="#4a5568" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.35" result="blur" />
            <feOffset dx="0.7" dy="1.75" result="off" />
            <feFlood flood-color="#12161c" flood-opacity="0.55" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={spineFace} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#2a140c" />
            <stop offset="32%" stop-color="#6a3a24" />
            <stop offset="58%" stop-color="#b07852" />
            <stop offset="82%" stop-color="#5a301c" />
            <stop offset="100%" stop-color="#3a1c10" />
          </linearGradient>
          <linearGradient id={coverFace} x1="0.12" y1="0" x2="0.22" y2="1">
            <stop offset="0%" stop-color="#8a5340" />
            <stop offset="28%" stop-color="#6a3624" />
            <stop offset="62%" stop-color="#4a2418" />
            <stop offset="100%" stop-color="#2e140e" />
          </linearGradient>
          <linearGradient id={coverSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3a1c12" />
            <stop offset="100%" stop-color="#1a0c08" />
          </linearGradient>
          <linearGradient id={leatherShade} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="rgba(255,220,180,0.22)" />
            <stop offset="42%" stop-color="rgba(255,220,180,0)" />
            <stop offset="100%" stop-color="rgba(20,8,4,0.28)" />
          </linearGradient>
          <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff3c4" />
            <stop offset="38%" stop-color="#e0bc58" />
            <stop offset="100%" stop-color="#9a7018" />
          </linearGradient>
          <linearGradient id={goldEdge} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#fff8d8" />
            <stop offset="55%" stop-color="#d4a430" />
            <stop offset="100%" stop-color="#7a5410" />
          </linearGradient>
          <linearGradient id={plate} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#5a301c" />
            <stop offset="45%" stop-color="#3a1c10" />
            <stop offset="100%" stop-color="#241008" />
          </linearGradient>
          <linearGradient id={pages} x1="0" y1="0" x2="1" y2="0.08">
            <stop offset="0%" stop-color="#fff8e8" />
            <stop offset="42%" stop-color="#ead8b4" />
            <stop offset="100%" stop-color="#c4a478" />
          </linearGradient>
          <linearGradient id={pageTop} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="#d8c49a" />
            <stop offset="55%" stop-color="#f4e8cc" />
            <stop offset="100%" stop-color="#fffaf0" />
          </linearGradient>
          <linearGradient id={pageSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#d8c49a" />
            <stop offset="100%" stop-color="#8a7048" />
          </linearGradient>
          <linearGradient id={ribbon} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#8a1020" />
            <stop offset="35%" stop-color="#d43040" />
            <stop offset="70%" stop-color="#a01828" />
            <stop offset="100%" stop-color="#6a0c18" />
          </linearGradient>
          <radialGradient id={enamel} cx="38%" cy="32%" r="70%">
            <stop offset="0%" stop-color="#7ee08a" />
            <stop offset="48%" stop-color="#2fbf55" />
            <stop offset="100%" stop-color="#148a38" />
          </radialGradient>
          <linearGradient id={ring} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stop-color="#fff6d0" />
            <stop offset="42%" stop-color="#e2bc58" />
            <stop offset="100%" stop-color="#8a6414" />
          </linearGradient>
          <clipPath id={spineClip}>
            <path d={SPINE} />
          </clipPath>
          <clipPath id={coverClip}>
            <path d={COVER_FACE} />
          </clipPath>
        </defs>

        <g transform={GROUP_TF}>
          <g filter={`url(#${shadow})`}>
            <path d={SPINE} fill="#000" />
            <path d={COVER_FACE} fill="#000" />
            <path d={FORE_EDGE} fill="#000" />
            <path d={PAGE_TOP} fill="#000" />
            <path d={BOTTOM} fill="#000" />
          </g>

          <g transform="translate(1.05 1.7)" opacity="0.95">
            <path d={SPINE} fill={`url(#${coverSide})`} />
            <path d={COVER_FACE} fill={`url(#${coverSide})`} />
            <path d={FORE_EDGE} fill={`url(#${pageSide})`} />
            <path d={BOTTOM} fill={`url(#${coverSide})`} />
          </g>

          <path d={BOTTOM} fill="#3a2410" />
          <path d="M 22.4 53.15 L 54.2 51.35 L 54.75 52.55 L 22.85 54.55 Z" fill="#c4a478" />
          <path d="M 14.7 51.85 L 21.9 53.35 L 22.4 54.2 L 14.55 51.85 Z" fill="#2a140c" />

          <path d={FORE_EDGE} fill={`url(#${pages})`} />
          {PAGE_STRIPES.map((x) => (
            <line
              key={x}
              x1={x}
              y1={12.6 + (x - 46.3) * 0.34}
              x2={x + 1.55}
              y2={50.4 + (x - 46.3) * 0.28}
              stroke="rgba(90,62,28,0.28)"
              stroke-width="0.42"
            />
          ))}
          <path
            d="M 54.95 16.1 L 56.0 50.4"
            fill="none"
            stroke="rgba(70,48,18,0.28)"
            stroke-width="0.55"
          />
          <path d={PAGE_TOP} fill={`url(#${pageTop})`} />
          <path
            d="M 45.15 10.35 L 51.85 12.7"
            fill="none"
            stroke="rgba(255,252,240,0.75)"
            stroke-width="0.55"
            stroke-linecap="round"
          />
          <g stroke="rgba(90,62,28,0.22)" stroke-width="0.35">
            <line x1="45.7" y1="10.85" x2="51.4" y2="12.9" />
            <line x1="46.15" y1="11.35" x2="52.15" y2="13.5" />
            <line x1="46.55" y1="11.8" x2="52.85" y2="14.0" />
          </g>

          <path d={SPINE} fill={`url(#${spineFace})`} />
          <g clip-path={`url(#${spineClip})`}>
            <path
              d="M 10.05 15.8 C 8.95 22.2 8.85 40.6 10.25 47.1"
              fill="none"
              stroke="rgba(255,220,180,0.42)"
              stroke-width="1.35"
              stroke-linecap="round"
            />
            <path
              d="M 13.05 13.2 C 10.55 18.6 10.45 45.4 13.25 50.0"
              fill="none"
              stroke="rgba(20,8,4,0.28)"
              stroke-width="0.85"
            />
          </g>

          <path
            d={COVER_FACE}
            fill={`url(#${coverFace})`}
            stroke="rgba(40,16,8,0.4)"
            stroke-width="0.45"
          />
          <g clip-path={`url(#${coverClip})`}>
            <path d={COVER_FACE} fill={`url(#${leatherShade})`} />
            <rect x="14.6" y="11.7" width="30.4" height="2.15" rx="0.7" fill="rgba(255,230,200,0.16)" />
            <path d="M 14.8 47.6 L 46.6 45.9 L 47.4 50.0 L 14.7 51.7 Z" fill="rgba(20,8,4,0.22)" />
          </g>

          <path
            d={GOLD_BORDER}
            fill="none"
            stroke={`url(#${goldEdge})`}
            stroke-width="1.05"
          />
          <path
            d="M 17.55 15.35 L 43.35 13.9"
            fill="none"
            stroke="rgba(255,248,220,0.55)"
            stroke-width="0.45"
            stroke-linecap="round"
          />

          <g transform="rotate(-3.2 30.5 21.15)">
            <rect
              x="20.55"
              y="17.2"
              width="20.0"
              height="8.05"
              rx="0.75"
              fill={`url(#${plate})`}
              stroke={`url(#${gold})`}
              stroke-width="0.75"
            />
            <rect x="21.25" y="17.55" width="18.6" height="1.2" rx="0.4" fill="rgba(255,230,170,0.2)" />
            <rect x="21.45" y="23.85" width="18.2" height="0.95" rx="0.3" fill="rgba(20,8,4,0.28)" />
            <rect x="22.45" y="19.55" width="16.15" height="1.05" rx="0.4" fill="#e8c868" />
            <rect x="24.15" y="21.45" width="12.75" height="1.05" rx="0.4" fill="#d4b050" />
          </g>

          <g transform="translate(30.35 35.35)">
            <ellipse cx="0.55" cy="0.85" rx="8.15" ry="8.15" fill="rgba(20,8,4,0.28)" />
            <circle cx="0" cy="0" r="8.05" fill={`url(#${ring})`} />
            <circle cx="0" cy="0" r="8.05" fill="none" stroke="rgba(60,32,8,0.4)" stroke-width="0.45" />
            <circle cx="0" cy="0" r="6.15" fill={`url(#${enamel})`} />
            <circle cx="0" cy="0" r="6.15" fill="none" stroke="rgba(20,70,30,0.35)" stroke-width="0.4" />
            <ellipse cx="-1.7" cy="-2.15" rx="3.4" ry="2.05" fill="rgba(255,255,255,0.28)" />
            <path
              d="M -3.05 0.15 L -0.85 2.45 L 3.35 -2.35"
              fill="none"
              stroke="rgba(10,40,16,0.35)"
              stroke-width="1.85"
              stroke-linecap="round"
              stroke-linejoin="round"
              transform="translate(0.35 0.45)"
            />
            <path
              d="M -3.05 0.15 L -0.85 2.45 L 3.35 -2.35"
              fill="none"
              stroke="#f7fff8"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </g>

          <path d={RIBBON_SHADOW} fill="#4a0c14" />
          <path d={RIBBON} fill={`url(#${ribbon})`} />
          <path
            d="M 44.35 8.15 C 45.55 6.85 47.65 6.85 48.55 8.25"
            fill="none"
            stroke="rgba(255,190,190,0.5)"
            stroke-width="0.7"
            stroke-linecap="round"
          />
          <path d="M 47.05 20.25 L 46.25 26.35 L 46.85 20.15 Z" fill="rgba(255,255,255,0.14)" />
        </g>
      </svg>
    </AppIconTile>
  )
}
