import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `files-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

const GROUP_TF = 'translate(32 33.2) rotate(-4.5) translate(-32 -33.2)'

/** 带左上标签的文件夹后壁。 */
const BACK_PATH = [
  'M 13.6 12.2',
  'H 26.4',
  'A 2.1 2.1 0 0 1 28.5 14.3',
  'V 17.8',
  'H 52.2',
  'A 2.5 2.5 0 0 1 54.7 20.3',
  'V 43.4',
  'A 2.5 2.5 0 0 1 52.2 45.9',
  'H 12.0',
  'A 2.5 2.5 0 0 1 9.5 43.4',
  'V 20.3',
  'A 2.5 2.5 0 0 1 12.0 17.8',
  'H 11.5',
  'V 14.3',
  'A 2.1 2.1 0 0 1 13.6 12.2',
  'Z',
].join(' ')

const TAB_PATH = [
  'M 13.6 12.2',
  'H 26.4',
  'A 2.1 2.1 0 0 1 28.5 14.3',
  'V 17.8',
  'H 11.5',
  'V 14.3',
  'A 2.1 2.1 0 0 1 13.6 12.2',
  'Z',
].join(' ')

/** 向前翻开的封面：上沿铰链、下沿更宽，读成立体纸板。 */
const FLAP_PATH = [
  'M 8.2 43.0',
  'L 55.8 43.0',
  'L 57.6 52.4',
  'A 2.0 2.0 0 0 1 55.6 54.4',
  'H 8.4',
  'A 2.0 2.0 0 0 1 6.4 52.4',
  'Z',
].join(' ')

const PAPER_LEFT_TF = 'translate(30.6 31.0) rotate(-11)'
const PAPER_MID_TF = 'translate(32.2 29.6) rotate(1.5)'
const PAPER_RIGHT_TF = 'translate(34.0 30.8) rotate(12.5)'

/**
 * 立体打开的马尼拉文件夹：后壁带标签、三张扇开的纸、前盖侧壁。
 * 和文件 App 里的金黄文件夹同一套颜色。
 */
export function FilesIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const backFace = svgUid(rawId, 'back-face')
  const backSide = svgUid(rawId, 'back-side')
  const tabFace = svgUid(rawId, 'tab-face')
  const flapFace = svgUid(rawId, 'flap-face')
  const flapSide = svgUid(rawId, 'flap-side')
  const flapEdge = svgUid(rawId, 'flap-edge')
  const paperLeft = svgUid(rawId, 'paper-l')
  const paperMid = svgUid(rawId, 'paper-m')
  const paperRight = svgUid(rawId, 'paper-r')
  const paperSide = svgUid(rawId, 'paper-side')

  return (
    <AppIconTile color="#8a5a28" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.35" result="blur" />
            <feOffset dx="0.6" dy="1.8" result="off" />
            <feFlood flood-color="#2a1808" flood-opacity="0.52" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={backFace} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f7e6b0" />
            <stop offset="42%" stop-color="#e8c56a" />
            <stop offset="100%" stop-color="#c49a40" />
          </linearGradient>
          <linearGradient id={backSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#a67c42" />
            <stop offset="100%" stop-color="#5a3c18" />
          </linearGradient>
          <linearGradient id={tabFace} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff1c2" />
            <stop offset="55%" stop-color="#e8c56a" />
            <stop offset="100%" stop-color="#c9a046" />
          </linearGradient>
          <linearGradient id={flapFace} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff6d4" />
            <stop offset="18%" stop-color="#f3dfa0" />
            <stop offset="62%" stop-color="#e2bc62" />
            <stop offset="100%" stop-color="#c4923a" />
          </linearGradient>
          <linearGradient id={flapSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8a6230" />
            <stop offset="100%" stop-color="#4e3010" />
          </linearGradient>
          <linearGradient id={flapEdge} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff8de" />
            <stop offset="100%" stop-color="#e8c888" />
          </linearGradient>
          <linearGradient id={paperLeft} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f7f2e8" />
            <stop offset="100%" stop-color="#d8ccb6" />
          </linearGradient>
          <linearGradient id={paperMid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fffef8" />
            <stop offset="100%" stop-color="#e8dcc8" />
          </linearGradient>
          <linearGradient id={paperRight} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="58%" stop-color="#f6f0e4" />
            <stop offset="100%" stop-color="#e2d4bc" />
          </linearGradient>
          <linearGradient id={paperSide} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#c4b498" />
            <stop offset="100%" stop-color="#9a886c" />
          </linearGradient>
        </defs>

        <g transform={GROUP_TF}>
          <g filter={`url(#${shadow})`}>
            <path d={BACK_PATH} fill="#000" />
            <g transform={PAPER_LEFT_TF}>
              <rect x="-11.6" y="-20.4" width="23.2" height="38.4" rx="1.15" fill="#000" />
            </g>
            <g transform={PAPER_MID_TF}>
              <rect x="-11.6" y="-20.8" width="23.2" height="39.0" rx="1.15" fill="#000" />
            </g>
            <g transform={PAPER_RIGHT_TF}>
              <rect x="-11.6" y="-20.2" width="23.2" height="38.2" rx="1.15" fill="#000" />
            </g>
            <path d={FLAP_PATH} fill="#000" />
          </g>

          <g transform="translate(1.15 1.8)" opacity="0.95">
            <path d={BACK_PATH} fill={`url(#${backSide})`} />
            <g transform={PAPER_LEFT_TF}>
              <rect x="-11.6" y="-20.4" width="23.2" height="38.4" rx="1.15" fill={`url(#${paperSide})`} />
            </g>
            <g transform={PAPER_MID_TF}>
              <rect x="-11.6" y="-20.8" width="23.2" height="39.0" rx="1.15" fill={`url(#${paperSide})`} />
            </g>
            <g transform={PAPER_RIGHT_TF}>
              <rect x="-11.6" y="-20.2" width="23.2" height="38.2" rx="1.15" fill={`url(#${paperSide})`} />
            </g>
            <path d={FLAP_PATH} fill={`url(#${flapSide})`} />
          </g>

          <path d={BACK_PATH} fill={`url(#${backFace})`} />
          <path d={TAB_PATH} fill={`url(#${tabFace})`} />
          <rect x="12.9" y="13.05" width="13.6" height="1.45" rx="0.55" fill="rgba(255,255,255,0.42)" />
          <path
            d="M 12.2 18.4 H 52.0"
            fill="none"
            stroke="rgba(255,255,255,0.28)"
            stroke-width="1.3"
            stroke-linecap="round"
          />
          <path d="M 11.2 39.6 H 52.6 V 45.2 H 11.2 Z" fill="rgba(80,45,10,0.16)" />
          <path d="M 11.4 40.6 H 52.8 V 45.4 H 11.4 Z" fill="rgba(70,40,10,0.28)" />

          <g transform={PAPER_LEFT_TF}>
            <rect
              x="-11.6"
              y="-20.4"
              width="23.2"
              height="38.4"
              rx="1.15"
              fill={`url(#${paperLeft})`}
              stroke="rgba(90,70,40,0.2)"
              stroke-width="0.4"
            />
            <rect x="-10.7" y="-19.5" width="21.4" height="1.35" rx="0.4" fill="rgba(255,255,255,0.45)" />
          </g>
          <g transform={PAPER_MID_TF}>
            <rect
              x="-11.6"
              y="-20.8"
              width="23.2"
              height="39.0"
              rx="1.15"
              fill={`url(#${paperMid})`}
              stroke="rgba(90,70,40,0.18)"
              stroke-width="0.4"
            />
            <rect x="-10.7" y="-19.9" width="21.4" height="1.4" rx="0.4" fill="rgba(255,255,255,0.55)" />
            <g stroke="rgba(70,55,35,0.16)" stroke-width="0.55" stroke-linecap="round">
              <line x1="-8.5" y1="-13.6" x2="8.6" y2="-13.6" />
              <line x1="-8.5" y1="-9.6" x2="7.0" y2="-9.6" />
              <line x1="-8.5" y1="-5.6" x2="8.2" y2="-5.6" />
            </g>
          </g>
          <g transform={PAPER_RIGHT_TF}>
            <rect
              x="-11.6"
              y="-20.2"
              width="23.2"
              height="38.2"
              rx="1.15"
              fill={`url(#${paperRight})`}
              stroke="rgba(90,70,40,0.22)"
              stroke-width="0.4"
            />
            <rect x="-10.65" y="-19.3" width="21.3" height="1.45" rx="0.4" fill="rgba(255,255,255,0.7)" />
            <g stroke="rgba(70,55,35,0.26)" stroke-width="0.58" stroke-linecap="round">
              <line x1="-8.3" y1="-13.0" x2="8.5" y2="-13.0" />
              <line x1="-8.3" y1="-8.9" x2="7.1" y2="-8.9" />
              <line x1="-8.3" y1="-4.8" x2="8.2" y2="-4.8" />
              <line x1="-8.3" y1="-0.7" x2="6.4" y2="-0.7" />
              <line x1="-8.3" y1="3.4" x2="5.0" y2="3.4" />
            </g>
            <path
              d="M 7.6 -20.2 V -13.2 L 11.6 -16.8 V -19.05 A 1.15 1.15 0 0 0 10.45 -20.2 Z"
              fill="#ead9b8"
            />
            <path d="M 7.6 -20.2 L 7.6 -13.2 L 11.6 -16.8 Z" fill="rgba(90,70,40,0.14)" />
            <path
              d="M 7.6 -20.2 L 11.6 -16.8"
              fill="none"
              stroke="rgba(90,70,40,0.22)"
              stroke-width="0.35"
            />
          </g>

          <g transform="translate(0.75 1.25)">
            <path d={FLAP_PATH} fill={`url(#${flapSide})`} />
          </g>
          <path
            d={FLAP_PATH}
            fill={`url(#${flapFace})`}
            stroke="rgba(70,42,10,0.3)"
            stroke-width="0.4"
          />
          <path d="M 8.6 43.0 L 55.4 43.0 L 55.9 44.55 L 8.15 44.55 Z" fill={`url(#${flapEdge})`} />
          <path
            d="M 8.5 43.15 L 55.5 43.15"
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            stroke-width="0.55"
            stroke-linecap="round"
          />
          <path
            d="M 8.3 44.55 L 55.7 44.55"
            fill="none"
            stroke="rgba(90,50,10,0.28)"
            stroke-width="0.45"
          />
          <path d="M 10.2 45.1 L 53.8 45.1 L 54.6 47.2 L 9.4 47.2 Z" fill="rgba(255,255,255,0.18)" />
          <path
            d="M 8.0 51.2 L 56.0 51.2 L 55.5 53.8 H 8.5 A 1.6 1.6 0 0 1 7.2 52.4 Z"
            fill="rgba(90,50,10,0.14)"
          />
          <ellipse cx="33.2" cy="44.7" rx="12.5" ry="1.15" fill="rgba(40,24,8,0.16)" />
        </g>
      </svg>
    </AppIconTile>
  )
}
