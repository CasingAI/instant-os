import { useId } from 'preact/hooks'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `registry-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function cylinderSidePath(cx: number, cy: number, rx: number, ry: number, h: number): string {
  const left = (cx - rx).toFixed(2)
  const right = (cx + rx).toFixed(2)
  const top = cy.toFixed(2)
  const bottom = (cy + h).toFixed(2)
  const rxf = rx.toFixed(2)
  const ryf = ry.toFixed(2)
  return [
    `M ${left} ${top}`,
    `L ${left} ${bottom}`,
    `A ${rxf} ${ryf} 0 0 0 ${right} ${bottom}`,
    `L ${right} ${top}`,
    `A ${rxf} ${ryf} 0 0 1 ${left} ${top}`,
    'Z',
  ].join(' ')
}

const RX = 21.0
const RY = 7.2
const THICKNESS = 5.85

const DISCS = [
  { id: 'bot', cx: 31.45, cy: 41.35, face: 'lo' },
  { id: 'mid', cx: 32.0, cy: 28.7, face: 'mid' },
  { id: 'top', cx: 32.55, cy: 16.05, face: 'hi' },
] as const

/**
 * iOS 6 注册表：三层金属数据盘。侧壁高光、顶面磁道和层间错位读出厚度。
 */
export function RegistryIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const side = svgUid(rawId, 'side')
  const sideDark = svgUid(rawId, 'side-dark')
  const band = svgUid(rawId, 'band')
  const topHi = svgUid(rawId, 'top-hi')
  const topMid = svgUid(rawId, 'top-mid')
  const topLo = svgUid(rawId, 'top-lo')
  const hub = svgUid(rawId, 'hub')
  const faceGrad = { hi: topHi, mid: topMid, lo: topLo } as const

  const sideClip = Object.fromEntries(DISCS.map((disc) => [disc.id, svgUid(rawId, `side-${disc.id}`)]))
  const faceClip = Object.fromEntries(DISCS.map((disc) => [disc.id, svgUid(rawId, `face-${disc.id}`)]))

  const bottom = DISCS[0]

  return (
    <AppIconTile color="#5b6d7f" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-45%" y="-20%" width="190%" height="190%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.35" result="blur" />
            <feOffset dx="0.4" dy="1.85" result="off" />
            <feFlood flood-color="#15202a" flood-opacity="0.55" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={side} gradientUnits="userSpaceOnUse" x1="9" y1="0" x2="55" y2="0">
            <stop offset="0%" stop-color="#5c6c7a" />
            <stop offset="9%" stop-color="#b4c4d2" />
            <stop offset="19%" stop-color="#f7fbfe" />
            <stop offset="33%" stop-color="#c4d1dc" />
            <stop offset="58%" stop-color="#7c8c9a" />
            <stop offset="82%" stop-color="#465460" />
            <stop offset="100%" stop-color="#24303a" />
          </linearGradient>
          <linearGradient id={sideDark} gradientUnits="userSpaceOnUse" x1="9" y1="0" x2="55" y2="0">
            <stop offset="0%" stop-color="#44525e" />
            <stop offset="22%" stop-color="#7a8a96" />
            <stop offset="100%" stop-color="#1a242c" />
          </linearGradient>
          <linearGradient id={band} gradientUnits="userSpaceOnUse" x1="9" y1="0" x2="55" y2="0">
            <stop offset="0%" stop-color="#245a92" />
            <stop offset="14%" stop-color="#7ab6ea" />
            <stop offset="40%" stop-color="#3c88c8" />
            <stop offset="100%" stop-color="#143454" />
          </linearGradient>
          <radialGradient id={topHi} cx="34%" cy="30%" r="74%">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="24%" stop-color="#eef4f8" />
            <stop offset="58%" stop-color="#b8c6d2" />
            <stop offset="100%" stop-color="#667888" />
          </radialGradient>
          <radialGradient id={topMid} cx="34%" cy="30%" r="74%">
            <stop offset="0%" stop-color="#f7fafc" />
            <stop offset="36%" stop-color="#c8d4de" />
            <stop offset="100%" stop-color="#627484" />
          </radialGradient>
          <radialGradient id={topLo} cx="34%" cy="30%" r="74%">
            <stop offset="0%" stop-color="#eef3f7" />
            <stop offset="40%" stop-color="#becad4" />
            <stop offset="100%" stop-color="#5c6e7c" />
          </radialGradient>
          <radialGradient id={hub} cx="38%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#e8eef2" />
            <stop offset="48%" stop-color="#8c969e" />
            <stop offset="100%" stop-color="#2e363e" />
          </radialGradient>
          {DISCS.flatMap((disc) => [
            <clipPath key={`side-${disc.id}`} id={sideClip[disc.id]}>
              <path d={cylinderSidePath(disc.cx, disc.cy, RX, RY, THICKNESS)} />
            </clipPath>,
            <clipPath key={`face-${disc.id}`} id={faceClip[disc.id]}>
              <ellipse cx={disc.cx} cy={disc.cy} rx={RX} ry={RY} />
            </clipPath>,
          ])}
        </defs>

        <g filter={`url(#${shadow})`}>
          <path d={cylinderSidePath(bottom.cx, bottom.cy, RX, RY, THICKNESS)} fill="#000" />
          <ellipse cx={bottom.cx} cy={bottom.cy} rx={RX} ry={RY} fill="#000" />
        </g>

        {DISCS.map((disc, index) => {
          const above = DISCS[index + 1]
          const bandY = disc.cy + THICKNESS * 0.34
          return (
            <g key={disc.id}>
              <path d={cylinderSidePath(disc.cx, disc.cy, RX, RY, THICKNESS)} fill={`url(#${side})`} />
              <g clip-path={`url(#${sideClip[disc.id]})`}>
                <ellipse
                  cx={disc.cx}
                  cy={disc.cy + THICKNESS}
                  rx={RX}
                  ry={RY}
                  fill={`url(#${sideDark})`}
                  opacity="0.5"
                />
                <rect x={disc.cx - RX} y={bandY} width={RX * 2} height="2.45" fill={`url(#${band})`} />
                <rect
                  x={disc.cx - RX}
                  y={bandY}
                  width={RX * 2}
                  height="0.55"
                  fill="rgba(255,255,255,0.32)"
                />
                <rect
                  x={disc.cx - RX}
                  y={bandY + 1.9}
                  width={RX * 2}
                  height="0.45"
                  fill="rgba(8,20,36,0.28)"
                />
                <rect
                  x={disc.cx - RX + 6.4}
                  y={disc.cy}
                  width="5.4"
                  height={THICKNESS}
                  fill="rgba(255,255,255,0.2)"
                />
              </g>
              <ellipse
                cx={disc.cx}
                cy={disc.cy + 0.85}
                rx={RX}
                ry={RY}
                fill="#3a4a58"
                opacity="0.55"
              />
              <ellipse cx={disc.cx} cy={disc.cy} rx={RX} ry={RY} fill={`url(#${faceGrad[disc.face]})`} />
              <g clip-path={`url(#${faceClip[disc.id]})`}>
                <ellipse
                  cx={disc.cx + 1.5}
                  cy={disc.cy + 3.9}
                  rx="15.8"
                  ry="4.4"
                  fill="rgba(30,44,58,0.14)"
                />
                <ellipse
                  cx={disc.cx - 6.0}
                  cy={disc.cy - 2.45}
                  rx="12.0"
                  ry="3.35"
                  fill="rgba(255,255,255,0.38)"
                />
                {disc.id === 'top' && (
                  <>
                    <ellipse
                      cx={disc.cx}
                      cy={disc.cy}
                      rx="16.6"
                      ry="5.05"
                      fill="none"
                      stroke="rgba(70,86,100,0.32)"
                      stroke-width="0.45"
                    />
                    <ellipse
                      cx={disc.cx}
                      cy={disc.cy}
                      rx="12.35"
                      ry="3.75"
                      fill="none"
                      stroke="rgba(70,86,100,0.24)"
                      stroke-width="0.4"
                    />
                    <ellipse
                      cx={disc.cx}
                      cy={disc.cy}
                      rx="8.05"
                      ry="2.42"
                      fill="none"
                      stroke="rgba(70,86,100,0.2)"
                      stroke-width="0.35"
                    />
                  </>
                )}
              </g>
              <ellipse
                cx={disc.cx}
                cy={disc.cy}
                rx={RX}
                ry={RY}
                fill="none"
                stroke="rgba(12,20,28,0.4)"
                stroke-width="0.55"
              />
              <ellipse
                cx={disc.cx}
                cy={disc.cy}
                rx={RX - 1.5}
                ry={RY - 1.3}
                fill="none"
                stroke="rgba(255,255,255,0.36)"
                stroke-width="0.5"
              />
              {above && (
                <g clip-path={`url(#${faceClip[disc.id]})`}>
                  <ellipse
                    cx={above.cx}
                    cy={above.cy + THICKNESS - 0.4}
                    rx={RX - 2.2}
                    ry={RY - 1.8}
                    fill="rgba(10,18,26,0.22)"
                  />
                </g>
              )}
            </g>
          )
        })}

        <ellipse cx={DISCS[2].cx} cy={DISCS[2].cy} rx="4.4" ry="1.62" fill={`url(#${hub})`} />
        <ellipse
          cx={DISCS[2].cx}
          cy={DISCS[2].cy}
          rx="4.4"
          ry="1.62"
          fill="none"
          stroke="rgba(16,24,32,0.45)"
          stroke-width="0.45"
        />
        <ellipse cx={DISCS[2].cx} cy={DISCS[2].cy - 0.1} rx="2.15" ry="0.78" fill="#242c34" />
        <ellipse
          cx={DISCS[2].cx - 0.65}
          cy={DISCS[2].cy - 0.36}
          rx="1.02"
          ry="0.36"
          fill="rgba(255,255,255,0.34)"
        />
      </svg>
    </AppIconTile>
  )
}
