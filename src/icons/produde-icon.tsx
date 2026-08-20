import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `produde-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

const HAMMER_TF = 'translate(33.4 24.2) rotate(-78)'
const WRENCH_TF = 'translate(31.8 39.6) rotate(34)'

const HANDLE_PATH = [
  'M -24.4 -2.55',
  'A 1.55 2.55 0 0 0 -24.4 2.55',
  'L 0.4 2.6',
  'L 0.4 -2.6',
  'Z',
].join(' ')

const HEAD_PATH = [
  'M -1.05 -8.15',
  'L 6.95 -8.15',
  'A 1.25 1.25 0 0 1 8.2 -6.9',
  'L 8.2 5.55',
  'A 1.25 1.25 0 0 1 6.95 6.8',
  'L -1.05 6.8',
  'A 1.25 1.25 0 0 1 -2.3 5.55',
  'L -2.3 -6.9',
  'A 1.25 1.25 0 0 1 -1.05 -8.15',
  'Z',
].join(' ')

const HEAD_TOP_PATH = 'M 8.2 -6.9 L 10.55 -6.15 L 10.05 6.15 L 8.2 5.55 Z'

const WRENCH_PATH = [
  'M -9.35 -2.05',
  'L -10.85 -5.4',
  'A 6.45 6.45 0 1 0 -10.85 5.4',
  'L -9.35 2.05',
  'L 7.05 2.05',
  'L 10.85 6.55',
  'L 20.45 6.8',
  'L 21.7 4.9',
  'L 15.2 1.05',
  'L 15.2 -1.05',
  'L 21.7 -4.9',
  'L 20.45 -6.8',
  'L 10.85 -6.55',
  'L 7.05 -2.05',
  'Z',
  'M -15.4 0',
  'm -2.75 0',
  'a 2.75 2.75 0 1 1 5.5 0',
  'a 2.75 2.75 0 1 1 -5.5 0',
].join(' ')

/**
 * iOS 6 工具交叉：木柄钢头锤子压在铬合金两用扳手上。
 * 侧壁下移、锤头顶面和材质分层，让 🛠️ 读成立体工具而不是 emoji。
 */
export function ProdudeIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const wood = svgUid(rawId, 'wood')
  const woodSide = svgUid(rawId, 'wood-side')
  const steel = svgUid(rawId, 'steel')
  const steelSide = svgUid(rawId, 'steel-side')
  const steelTop = svgUid(rawId, 'steel-top')
  const chrome = svgUid(rawId, 'chrome')
  const chromeSide = svgUid(rawId, 'chrome-side')
  const ferrule = svgUid(rawId, 'ferrule')
  const wrenchClip = svgUid(rawId, 'wrench-clip')

  return (
    <AppIconTile color="#2f6fed" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="blur" />
            <feOffset dx="0.75" dy="1.7" result="off" />
            <feFlood flood-color="#0d2a6a" flood-opacity="0.52" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={wood} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#e8c48e" />
            <stop offset="20%" stop-color="#d09250" />
            <stop offset="48%" stop-color="#a05e28" />
            <stop offset="100%" stop-color="#5a2e10" />
          </linearGradient>
          <linearGradient id={woodSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6a3a14" />
            <stop offset="100%" stop-color="#3a1c08" />
          </linearGradient>
          <linearGradient id={steel} x1="0.12" y1="0" x2="0.88" y2="1">
            <stop offset="0%" stop-color="#f7f9fc" />
            <stop offset="28%" stop-color="#c5cdd8" />
            <stop offset="62%" stop-color="#8a94a2" />
            <stop offset="100%" stop-color="#4c5562" />
          </linearGradient>
          <linearGradient id={steelSide} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#6a7380" />
            <stop offset="100%" stop-color="#2a323c" />
          </linearGradient>
          <linearGradient id={steelTop} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="42%" stop-color="#d8dee8" />
            <stop offset="100%" stop-color="#8a94a4" />
          </linearGradient>
          <linearGradient id={chrome} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="16%" stop-color="#e6ecf4" />
            <stop offset="40%" stop-color="#b4becc" />
            <stop offset="68%" stop-color="#768092" />
            <stop offset="100%" stop-color="#485060" />
          </linearGradient>
          <linearGradient id={chromeSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#5a6474" />
            <stop offset="100%" stop-color="#2c3440" />
          </linearGradient>
          <linearGradient id={ferrule} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f7f4ec" />
            <stop offset="38%" stop-color="#d0cbb8" />
            <stop offset="100%" stop-color="#7a7464" />
          </linearGradient>
          <clipPath id={wrenchClip}>
            <path fill-rule="evenodd" d={WRENCH_PATH} />
          </clipPath>
        </defs>

        <g filter={`url(#${shadow})`}>
          <g transform={WRENCH_TF}>
            <path fill="#000" fill-rule="evenodd" d={WRENCH_PATH} />
          </g>
          <g transform={HAMMER_TF}>
            <path fill="#000" d={HANDLE_PATH} />
            <path fill="#000" d={HEAD_PATH} />
            <path fill="#000" d={HEAD_TOP_PATH} />
          </g>
        </g>

        <g transform="translate(1.05 1.7)" opacity="0.94">
          <g transform={WRENCH_TF}>
            <path fill={`url(#${chromeSide})`} fill-rule="evenodd" d={WRENCH_PATH} />
          </g>
          <g transform={HAMMER_TF}>
            <path fill={`url(#${woodSide})`} d={HANDLE_PATH} />
            <path fill={`url(#${steelSide})`} d={HEAD_PATH} />
            <path fill={`url(#${steelSide})`} d={HEAD_TOP_PATH} />
          </g>
        </g>

        <g transform={WRENCH_TF}>
          <path
            fill={`url(#${chrome})`}
            fill-rule="evenodd"
            stroke="rgba(28,34,46,0.38)"
            stroke-width="0.4"
            d={WRENCH_PATH}
          />
          <g clip-path={`url(#${wrenchClip})`}>
            <path
              d="M -16.9 -5.25 A 5.55 5.55 0 0 1 -9.5 -2.05 L 7.3 -1.55 L 11.1 -5.6 L 19.5 -5.85 L 20.8 -4.25"
              fill="rgba(255,255,255,0.38)"
            />
            <path
              d="M -16.9 5.25 A 5.55 5.55 0 0 0 -9.5 2.05 L 7.3 1.55 L 11.1 5.6 L 19.5 5.85 L 20.8 4.25"
              fill="rgba(24,30,42,0.2)"
            />
            <path
              d="M -8.9 -1.25 L 6.9 -1.4"
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              stroke-width="0.75"
              stroke-linecap="round"
            />
          </g>
          <circle cx="-15.4" cy="0" r="2.75" fill="#243040" />
          <circle cx="-15.4" cy="0" r="2.75" fill="none" stroke="rgba(12,16,24,0.55)" stroke-width="0.45" />
          <circle cx="-15.65" cy="0.42" r="2.08" fill="rgba(0,0,0,0.32)" />
          <ellipse cx="-14.85" cy="-0.55" rx="1.22" ry="0.95" fill="rgba(255,255,255,0.18)" />
          <path d="M 15.2 1.05 L 21.7 4.9 L 20.45 6.8 L 12.35 5.4 Z" fill="rgba(20,26,36,0.3)" />
          <path d="M 15.2 -1.05 L 21.7 -4.9 L 20.45 -6.8 L 12.35 -5.4 Z" fill="rgba(255,255,255,0.14)" />
        </g>

        <g transform={HAMMER_TF}>
          <path fill={`url(#${wood})`} d={HANDLE_PATH} />
          <path
            d="M -23.45 -1.5 L -0.1 -1.8"
            fill="none"
            stroke="rgba(255,232,185,0.46)"
            stroke-width="1.1"
            stroke-linecap="round"
          />
          <path
            d="M -23.3 0.2 L -0.15 0.1"
            fill="none"
            stroke="rgba(90,40,8,0.16)"
            stroke-width="0.4"
            stroke-linecap="round"
          />
          <path
            d="M -23.15 1.55 L -0.1 1.75"
            fill="none"
            stroke="rgba(40,16,4,0.3)"
            stroke-width="0.72"
            stroke-linecap="round"
          />
          <ellipse cx="-24.05" cy="0" rx="0.75" ry="2.02" fill="rgba(40,18,6,0.42)" />
          <rect
            x="-1.1"
            y="-2.78"
            width="2.65"
            height="5.56"
            fill={`url(#${ferrule})`}
            stroke="rgba(40,36,28,0.32)"
            stroke-width="0.28"
          />
          <line x1="-0.15" y1="-2.62" x2="-0.15" y2="2.62" stroke="rgba(0,0,0,0.2)" stroke-width="0.35" />
          <line x1="-0.88" y1="-2.15" x2="1.25" y2="-2.15" stroke="rgba(255,255,255,0.5)" stroke-width="0.42" />
          <path fill={`url(#${steel})`} d={HEAD_PATH} />
          <path d="M -2.05 -6.55 L 1.35 -6.55 L 1.35 5.2 L -2.05 5.2 Z" fill="rgba(255,255,255,0.22)" />
          <path d="M 5.15 -6.4 L 8.2 -6.4 L 8.2 5.1 L 5.15 5.1 Z" fill="rgba(20,24,32,0.16)" />
          <path
            d="M -1.05 -8.15 L 6.95 -8.15 A 1.25 1.25 0 0 1 8.2 -6.9 L -2.3 -6.9 A 1.25 1.25 0 0 1 -1.05 -8.15 Z"
            fill="rgba(255,255,255,0.26)"
          />
          <path fill={`url(#${steelTop})`} d={HEAD_TOP_PATH} />
          <path d="M 8.2 -6.9 L 10.55 -6.15 L 9.35 -6.15 L 8.2 -6.55 Z" fill="rgba(255,255,255,0.45)" />
          <path d="M 10.35 -6.15 L 10.55 -6.15 L 10.05 6.15 L 9.85 6.05 Z" fill="rgba(255,255,255,0.2)" />
        </g>
      </svg>
    </AppIconTile>
  )
}
