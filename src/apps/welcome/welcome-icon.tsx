import { useId } from 'preact/hooks'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `welcome-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
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

const FRAME_OUTER = roundedRectPath(18.6, 8.1, 32.4, 48.2, 2.4)
const FRAME_INNER = roundedRectPath(22.5, 12.3, 24.6, 41.8, 1.15)
const FRAME_PATH = `${FRAME_OUTER} ${FRAME_INNER}`

const DOOR_FACE = 'M 22.50 12.30 L 6.40 10.15 L 6.40 56.25 L 22.50 54.10 Z'
const DOOR_SIDE = 'M 6.40 10.15 L 4.28 10.70 L 4.28 55.70 L 6.40 56.25 Z'
const DOOR_PANEL_TOP = 'M 19.92 15.45 L 9.94 14.28 L 9.94 28.70 L 19.92 28.98 Z'
const DOOR_PANEL_BOT = 'M 19.92 32.35 L 9.94 32.28 L 9.94 50.32 L 19.92 49.28 Z'

/**
 * 半开的门，暖光从屋里漫出来。欢迎中心：进来、开始用。
 */
export function WelcomeIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const glow = svgUid(rawId, 'glow')
  const interior = svgUid(rawId, 'interior')
  const frameFace = svgUid(rawId, 'frame-face')
  const frameSide = svgUid(rawId, 'frame-side')
  const doorFace = svgUid(rawId, 'door-face')
  const doorSide = svgUid(rawId, 'door-side')
  const panel = svgUid(rawId, 'panel')
  const knob = svgUid(rawId, 'knob')
  const sill = svgUid(rawId, 'sill')
  const openingClip = svgUid(rawId, 'opening')

  return (
    <AppIconTile color="#2f8490" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="blur" />
            <feOffset dx="0.6" dy="1.7" result="off" />
            <feFlood flood-color="#0a2a32" flood-opacity="0.55" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <radialGradient id={glow} cx="55%" cy="48%" r="58%">
            <stop offset="0%" stop-color="#fff6c8" stop-opacity="0.95" />
            <stop offset="42%" stop-color="#f0c14d" stop-opacity="0.55" />
            <stop offset="100%" stop-color="#f0c14d" stop-opacity="0" />
          </radialGradient>
          <radialGradient id={interior} cx="42%" cy="38%" r="72%">
            <stop offset="0%" stop-color="#fff6d0" />
            <stop offset="38%" stop-color="#ffd56a" />
            <stop offset="78%" stop-color="#e49a28" />
            <stop offset="100%" stop-color="#b56a12" />
          </radialGradient>
          <linearGradient id={frameFace} x1="0.12" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stop-color="#f7efe0" />
            <stop offset="42%" stop-color="#e2d2b4" />
            <stop offset="100%" stop-color="#b89a6c" />
          </linearGradient>
          <linearGradient id={frameSide} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#8a7048" />
            <stop offset="100%" stop-color="#5a4428" />
          </linearGradient>
          <linearGradient id={doorFace} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fffaf0" />
            <stop offset="36%" stop-color="#f0e4cc" />
            <stop offset="100%" stop-color="#c8b090" />
          </linearGradient>
          <linearGradient id={doorSide} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#6a5434" />
            <stop offset="100%" stop-color="#a88858" />
          </linearGradient>
          <linearGradient id={panel} x1="0.8" y1="0" x2="0.1" y2="1">
            <stop offset="0%" stop-color="#d8c8a8" />
            <stop offset="55%" stop-color="#b89a70" />
            <stop offset="100%" stop-color="#8e7348" />
          </linearGradient>
          <radialGradient id={knob} cx="32%" cy="28%" r="68%">
            <stop offset="0%" stop-color="#fff3b0" />
            <stop offset="42%" stop-color="#e8b84a" />
            <stop offset="100%" stop-color="#9a6a12" />
          </radialGradient>
          <linearGradient id={sill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#efe0c4" />
            <stop offset="100%" stop-color="#a88858" />
          </linearGradient>
          <clipPath id={openingClip}>
            <path d={FRAME_INNER} />
          </clipPath>
        </defs>

        <ellipse cx="34" cy="57.6" rx="20" ry="3.8" fill="rgba(8, 28, 34, 0.28)" />
        <ellipse cx="28" cy="56.4" rx="16" ry="5.2" fill={`url(#${glow})`} />

        <g filter={`url(#${shadow})`}>
          <path d={FRAME_OUTER} fill="#000" />
          <path d={DOOR_FACE} fill="#000" />
          <path d={DOOR_SIDE} fill="#000" />
        </g>

        <g transform="translate(1.05 1.45)" opacity="0.92">
          <path d={FRAME_OUTER} fill={`url(#${frameSide})`} />
        </g>

        <g clip-path={`url(#${openingClip})`}>
          <rect x="22.5" y="12.3" width="24.6" height="41.8" fill={`url(#${interior})`} />
          <ellipse cx="34.8" cy="28" rx="9.5" ry="13" fill="rgba(255, 248, 210, 0.55)" />
          <path d="M 24.2 54.1 L 45.8 54.1 L 42.4 44.6 L 26.8 44.6 Z" fill="rgba(180, 110, 28, 0.28)" />
          <rect x="31.4" y="22.5" width="7.2" height="22.2" rx="0.6" fill="rgba(255, 236, 170, 0.35)" />
        </g>

        <path
          d={FRAME_PATH}
          fill={`url(#${frameFace})`}
          fill-rule="evenodd"
          stroke="rgba(70, 48, 18, 0.38)"
          stroke-width="0.45"
        />
        <path
          d={FRAME_INNER}
          fill="none"
          stroke="rgba(90, 58, 20, 0.45)"
          stroke-width="1.35"
        />
        <path
          d={FRAME_INNER}
          fill="none"
          stroke="rgba(255, 210, 120, 0.55)"
          stroke-width="0.7"
        />
        <rect x="19.2" y="8.4" width="26" height="3.2" rx="1.2" fill="rgba(255, 255, 255, 0.38)" />

        <rect
          x="18.2"
          y="54.15"
          width="33.2"
          height="3.35"
          rx="0.7"
          fill={`url(#${sill})`}
          stroke="rgba(70, 48, 18, 0.35)"
          stroke-width="0.4"
        />
        <rect x="18.6" y="54.3" width="32.4" height="1.05" rx="0.4" fill="rgba(255, 255, 255, 0.28)" />

        <path d={DOOR_SIDE} fill={`url(#${doorSide})`} />
        <path
          d={DOOR_FACE}
          fill={`url(#${doorFace})`}
          stroke="rgba(70, 48, 18, 0.4)"
          stroke-width="0.5"
        />
        <path
          d="M 21.85 13.05 L 7.55 11.15"
          fill="none"
          stroke="rgba(255, 255, 255, 0.5)"
          stroke-width="1.15"
          stroke-linecap="round"
        />
        <path
          d="M 22.35 13.4 L 22.35 53.0"
          fill="none"
          stroke="rgba(255, 210, 120, 0.7)"
          stroke-width="1.35"
          stroke-linecap="round"
        />

        <path
          d={DOOR_PANEL_TOP}
          fill={`url(#${panel})`}
          stroke="rgba(70, 48, 18, 0.28)"
          stroke-width="0.4"
        />
        <path
          d={DOOR_PANEL_BOT}
          fill={`url(#${panel})`}
          stroke="rgba(70, 48, 18, 0.28)"
          stroke-width="0.4"
        />
        <path
          d="M 19.35 16.05 L 10.55 15.05"
          fill="none"
          stroke="rgba(255, 255, 255, 0.22)"
          stroke-width="0.7"
          stroke-linecap="round"
        />
        <path
          d="M 19.35 32.95 L 10.55 32.85"
          fill="none"
          stroke="rgba(255, 255, 255, 0.2)"
          stroke-width="0.7"
          stroke-linecap="round"
        />

        <ellipse cx="11.15" cy="36.9" rx="2.15" ry="2.05" fill="rgba(90, 58, 16, 0.35)" />
        <circle cx="11.05" cy="36.55" r="2.05" fill={`url(#${knob})`} />
        <circle
          cx="11.05"
          cy="36.55"
          r="2.05"
          fill="none"
          stroke="rgba(90, 50, 8, 0.45)"
          stroke-width="0.4"
        />
        <ellipse cx="10.35" cy="35.75" rx="0.85" ry="0.65" fill="rgba(255, 255, 255, 0.55)" />
      </svg>
    </AppIconTile>
  )
}
