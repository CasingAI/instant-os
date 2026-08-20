import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

type Tooth = {
  y: number
  h: number
  depth: number
}

type KeySpec = {
  bowR: number
  holeR: number
  shaftHalf: number
  length: number
  teeth: readonly Tooth[]
}

function svgUid(rawId: string, suffix: string): string {
  return `keychain-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function keyOutlinePath({ bowR, holeR, shaftHalf: s, length, teeth }: KeySpec): string {
  const attachY = Math.sqrt(bowR * bowR - s * s)
  const tipY = length
  const tipHalf = s * 0.72
  const parts = [
    `M ${(-s).toFixed(2)} ${attachY.toFixed(2)}`,
    `A ${bowR.toFixed(2)} ${bowR.toFixed(2)} 0 1 1 ${s.toFixed(2)} ${attachY.toFixed(2)}`,
  ]
  for (const tooth of teeth) {
    parts.push(
      `L ${s.toFixed(2)} ${tooth.y.toFixed(2)}`,
      `L ${(s + tooth.depth).toFixed(2)} ${tooth.y.toFixed(2)}`,
      `L ${(s + tooth.depth).toFixed(2)} ${(tooth.y + tooth.h).toFixed(2)}`,
      `L ${s.toFixed(2)} ${(tooth.y + tooth.h).toFixed(2)}`,
    )
  }
  parts.push(
    `L ${s.toFixed(2)} ${tipY.toFixed(2)}`,
    `L ${tipHalf.toFixed(2)} ${(tipY + 1.2).toFixed(2)}`,
    `L ${(-tipHalf).toFixed(2)} ${(tipY + 1.2).toFixed(2)}`,
    `L ${(-s).toFixed(2)} ${tipY.toFixed(2)}`,
    `L ${(-s).toFixed(2)} ${attachY.toFixed(2)}`,
    'Z',
    `M ${holeR.toFixed(2)} 0`,
    `A ${holeR.toFixed(2)} ${holeR.toFixed(2)} 0 1 0 ${(-holeR).toFixed(2)} 0`,
    `A ${holeR.toFixed(2)} ${holeR.toFixed(2)} 0 1 0 ${holeR.toFixed(2)} 0`,
    'Z',
  )
  return parts.join(' ')
}

const LEFT_TF = 'translate(21.4 17.2) rotate(34)'
const RIGHT_TF = 'translate(42.8 17.4) rotate(-31)'
const FRONT_TF = 'translate(32 19.6) rotate(7)'

const LEFT_KEY: KeySpec = {
  bowR: 7.45,
  holeR: 3.25,
  shaftHalf: 1.95,
  length: 30.2,
  teeth: [
    { y: 16.4, h: 2.6, depth: 3.6 },
    { y: 22.6, h: 3.2, depth: 2.75 },
  ],
}

const RIGHT_KEY: KeySpec = {
  bowR: 6.95,
  holeR: 3.05,
  shaftHalf: 1.85,
  length: 28.4,
  teeth: [
    { y: 15.6, h: 2.3, depth: 3.05 },
    { y: 20.0, h: 1.85, depth: 2.0 },
    { y: 24.2, h: 2.6, depth: 3.35 },
  ],
}

const FRONT_KEY: KeySpec = {
  bowR: 8.55,
  holeR: 3.6,
  shaftHalf: 2.2,
  length: 32.4,
  teeth: [
    { y: 18.2, h: 2.6, depth: 4.15 },
    { y: 22.6, h: 2.15, depth: 2.5 },
    { y: 26.8, h: 2.95, depth: 3.85 },
  ],
}

const LEFT_PATH = keyOutlinePath(LEFT_KEY)
const RIGHT_PATH = keyOutlinePath(RIGHT_KEY)
const FRONT_PATH = keyOutlinePath(FRONT_KEY)

/**
 * iOS 6 钥匙串：三把叠在一起的黄铜 / 青铜 / 镍钥匙，带侧壁和柱面高光。
 */
export function KeychainIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const bronze = svgUid(rawId, 'bronze')
  const nickel = svgUid(rawId, 'nickel')
  const brass = svgUid(rawId, 'brass')
  const clipL = svgUid(rawId, 'clip-l')
  const clipR = svgUid(rawId, 'clip-r')
  const clipF = svgUid(rawId, 'clip-f')

  return (
    <AppIconTile color="#f5a623" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-45%" y="-25%" width="190%" height="190%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="blur" />
            <feOffset dx="0.75" dy="1.7" result="off" />
            <feFlood flood-color="#7a4208" flood-opacity="0.55" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={bronze} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#f6dcac" />
            <stop offset="16%" stop-color="#d8a85e" />
            <stop offset="42%" stop-color="#b07830" />
            <stop offset="70%" stop-color="#744814" />
            <stop offset="100%" stop-color="#42280a" />
          </linearGradient>
          <linearGradient id={nickel} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="14%" stop-color="#e8ecf4" />
            <stop offset="40%" stop-color="#b8c0cc" />
            <stop offset="68%" stop-color="#727a88" />
            <stop offset="100%" stop-color="#3a424c" />
          </linearGradient>
          <linearGradient id={brass} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#fff8d0" />
            <stop offset="14%" stop-color="#f2d45c" />
            <stop offset="38%" stop-color="#d8a41c" />
            <stop offset="66%" stop-color="#a07410" />
            <stop offset="100%" stop-color="#5c4208" />
          </linearGradient>
          <clipPath id={clipL}>
            <path d={LEFT_PATH} fill-rule="evenodd" />
          </clipPath>
          <clipPath id={clipR}>
            <path d={RIGHT_PATH} fill-rule="evenodd" />
          </clipPath>
          <clipPath id={clipF}>
            <path d={FRONT_PATH} fill-rule="evenodd" />
          </clipPath>
        </defs>

        <g filter={`url(#${shadow})`}>
          <g transform={LEFT_TF}>
            <path d={LEFT_PATH} fill="#000" fill-rule="evenodd" />
          </g>
          <g transform={RIGHT_TF}>
            <path d={RIGHT_PATH} fill="#000" fill-rule="evenodd" />
          </g>
          <g transform={FRONT_TF}>
            <path d={FRONT_PATH} fill="#000" fill-rule="evenodd" />
          </g>
        </g>

        <g transform="translate(0.95 1.6)" opacity="0.94">
          <g transform={LEFT_TF}>
            <path d={LEFT_PATH} fill="#4e300e" fill-rule="evenodd" />
          </g>
          <g transform={RIGHT_TF}>
            <path d={RIGHT_PATH} fill="#3a424c" fill-rule="evenodd" />
          </g>
          <g transform={FRONT_TF}>
            <path d={FRONT_PATH} fill="#6c4a0a" fill-rule="evenodd" />
          </g>
        </g>

        <g transform={LEFT_TF}>
          <path
            d={LEFT_PATH}
            fill={`url(#${bronze})`}
            fill-rule="evenodd"
            stroke="rgba(42,22,6,0.4)"
            stroke-width="0.4"
          />
          <g clip-path={`url(#${clipL})`}>
            <ellipse cx="-2.15" cy="-2.4" rx="3.5" ry="2.65" fill="rgba(255,255,255,0.3)" />
            <path
              d="M -1.2 7.6 L -1.2 29.4"
              fill="none"
              stroke="rgba(255,232,190,0.34)"
              stroke-width="0.75"
              stroke-linecap="round"
            />
            <path
              d="M 0.85 7.8 L 0.85 29.2"
              fill="none"
              stroke="rgba(40,20,4,0.16)"
              stroke-width="0.45"
              stroke-linecap="round"
            />
          </g>
          <circle r={LEFT_KEY.holeR} fill="none" stroke="rgba(42,22,6,0.42)" stroke-width="0.55" />
          <circle
            cx="-0.35"
            cy="-0.4"
            r={LEFT_KEY.holeR - 0.4}
            fill="none"
            stroke="rgba(255,255,255,0.28)"
            stroke-width="0.4"
          />
        </g>

        <g transform={RIGHT_TF}>
          <path
            d={RIGHT_PATH}
            fill={`url(#${nickel})`}
            fill-rule="evenodd"
            stroke="rgba(24,28,36,0.4)"
            stroke-width="0.4"
          />
          <g clip-path={`url(#${clipR})`}>
            <ellipse cx="-2.0" cy="-2.2" rx="3.2" ry="2.4" fill="rgba(255,255,255,0.4)" />
            <path
              d="M -1.1 7.1 L -1.1 27.4"
              fill="none"
              stroke="rgba(255,255,255,0.42)"
              stroke-width="0.7"
              stroke-linecap="round"
            />
            <path
              d="M 0.8 7.3 L 0.8 27.2"
              fill="none"
              stroke="rgba(24,28,36,0.16)"
              stroke-width="0.4"
              stroke-linecap="round"
            />
          </g>
          <circle r={RIGHT_KEY.holeR} fill="none" stroke="rgba(24,28,36,0.4)" stroke-width="0.5" />
          <circle
            cx="-0.32"
            cy="-0.38"
            r={RIGHT_KEY.holeR - 0.4}
            fill="none"
            stroke="rgba(255,255,255,0.36)"
            stroke-width="0.4"
          />
        </g>

        <g transform={FRONT_TF}>
          <path
            d={FRONT_PATH}
            fill={`url(#${brass})`}
            fill-rule="evenodd"
            stroke="rgba(70,42,6,0.42)"
            stroke-width="0.45"
          />
          <g clip-path={`url(#${clipF})`}>
            <ellipse cx="-2.45" cy="-2.65" rx="3.9" ry="2.95" fill="rgba(255,255,255,0.34)" />
            <path
              d="M -1.3 8.7 L -1.3 31.6"
              fill="none"
              stroke="rgba(255,242,185,0.4)"
              stroke-width="0.85"
              stroke-linecap="round"
            />
            <path
              d="M 1.05 8.9 L 1.05 31.4"
              fill="none"
              stroke="rgba(70,42,6,0.18)"
              stroke-width="0.5"
              stroke-linecap="round"
            />
            <rect
              x="-2.7"
              y="8.55"
              width="5.4"
              height="2.25"
              rx="0.55"
              fill="rgba(255,255,255,0.18)"
              stroke="rgba(70,42,6,0.3)"
              stroke-width="0.35"
            />
          </g>
          <circle r={FRONT_KEY.holeR} fill="none" stroke="rgba(70,42,6,0.44)" stroke-width="0.55" />
          <circle
            cx="-0.42"
            cy="-0.48"
            r={FRONT_KEY.holeR - 0.47}
            fill="none"
            stroke="rgba(255,255,255,0.34)"
            stroke-width="0.45"
          />
        </g>
      </svg>
    </AppIconTile>
  )
}
