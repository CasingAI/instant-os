import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `services-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
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

const GROUP_TF = 'translate(32 33.1) rotate(-6.2) translate(-32 -33.1)'

const PLATE = { x: 10.2, y: 8.2, w: 43.6, h: 47.6, r: 5.4 }
const PLATE_PATH = roundedRectPath(PLATE.x, PLATE.y, PLATE.w, PLATE.h, PLATE.r)

const WELL = { x: 16.6, w: 30.8, h: 10.35, r: 5.175 }
const SWITCHES = [
  { y: 14.35, on: true },
  { y: 27.85, on: true },
  { y: 41.35, on: false },
] as const

const SCREWS = [
  { x: 14.35, y: 12.35 },
  { x: 49.65, y: 12.35 },
  { x: 14.35, y: 51.65 },
  { x: 49.65, y: 51.65 },
] as const

/**
 * 立体金属控制盒：三枚 iOS 6 式拨动开关，开着的亮绿灯。
 * 侧壁、凹槽和旋钮高光用来读厚度，对应服务的开 / 停。
 */
export function ServicesIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const plateFace = svgUid(rawId, 'plate-face')
  const plateSide = svgUid(rawId, 'plate-side')
  const plateBevel = svgUid(rawId, 'plate-bevel')
  const onFill = svgUid(rawId, 'on-fill')
  const offFill = svgUid(rawId, 'off-fill')
  const knobFill = svgUid(rawId, 'knob')
  const screwFill = svgUid(rawId, 'screw')

  return (
    <AppIconTile color="#3e5368" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="blur" />
            <feOffset dx="0.7" dy="1.7" result="off" />
            <feFlood flood-color="#0c1824" flood-opacity="0.58" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={plateFace} x1="0.12" y1="0" x2="0.08" y2="1">
            <stop offset="0%" stop-color="#d5dbe4" />
            <stop offset="36%" stop-color="#9aa4b0" />
            <stop offset="100%" stop-color="#5a646e" />
          </linearGradient>
          <linearGradient id={plateSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4a5460" />
            <stop offset="100%" stop-color="#1e242a" />
          </linearGradient>
          <linearGradient id={plateBevel} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(255,255,255,0.5)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0)" />
          </linearGradient>
          <linearGradient id={onFill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8ef0a8" />
            <stop offset="42%" stop-color="#2fc861" />
            <stop offset="100%" stop-color="#157a38" />
          </linearGradient>
          <linearGradient id={offFill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7a848e" />
            <stop offset="45%" stop-color="#4a545e" />
            <stop offset="100%" stop-color="#2a3238" />
          </linearGradient>
          <radialGradient id={knobFill} cx="36%" cy="30%" r="68%">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="48%" stop-color="#e4e6ea" />
            <stop offset="100%" stop-color="#8e949c" />
          </radialGradient>
          <radialGradient id={screwFill} cx="38%" cy="32%" r="70%">
            <stop offset="0%" stop-color="#d8dee6" />
            <stop offset="55%" stop-color="#8a929c" />
            <stop offset="100%" stop-color="#4a525c" />
          </radialGradient>
        </defs>

        <g transform={GROUP_TF}>
          <g filter={`url(#${shadow})`}>
            <path d={PLATE_PATH} fill="#000" />
          </g>

          <g transform="translate(1.35 2.05)" opacity="0.96">
            <path d={PLATE_PATH} fill={`url(#${plateSide})`} />
          </g>

          <path
            d={PLATE_PATH}
            fill={`url(#${plateFace})`}
            stroke="rgba(12,16,20,0.45)"
            stroke-width="0.5"
          />
          <rect
            x={PLATE.x + 1.4}
            y={PLATE.y + 1.15}
            width={PLATE.w - 2.8}
            height="7.2"
            rx="2.2"
            fill={`url(#${plateBevel})`}
          />
          <rect
            x={PLATE.x + 1.15}
            y={PLATE.y + 9.2}
            width="1.25"
            height={PLATE.h - 18.4}
            rx="0.6"
            fill="rgba(255,255,255,0.2)"
          />
          <rect
            x={PLATE.x + 1.6}
            y={PLATE.y + PLATE.h - 4.4}
            width={PLATE.w - 3.2}
            height="2.2"
            rx="1"
            fill="rgba(0,0,0,0.18)"
          />

          {SCREWS.map((screw) => (
            <g key={`${screw.x}-${screw.y}`}>
              <circle cx={screw.x + 0.25} cy={screw.y + 0.35} r="1.55" fill="rgba(0,0,0,0.35)" />
              <circle cx={screw.x} cy={screw.y} r="1.55" fill={`url(#${screwFill})`} />
              <circle
                cx={screw.x}
                cy={screw.y}
                r="1.55"
                fill="none"
                stroke="rgba(20,24,28,0.4)"
                stroke-width="0.35"
              />
              <line
                x1={screw.x - 0.95}
                y1={screw.y}
                x2={screw.x + 0.95}
                y2={screw.y}
                stroke="rgba(20,24,28,0.7)"
                stroke-width="0.45"
                stroke-linecap="round"
              />
              <circle cx={screw.x - 0.4} cy={screw.y - 0.45} r="0.4" fill="rgba(255,255,255,0.4)" />
            </g>
          ))}

          {SWITCHES.map((item) => {
            const fill = item.on ? `url(#${onFill})` : `url(#${offFill})`
            const knobR = 4.55
            const knobCx = item.on ? WELL.x + WELL.w - knobR - 0.55 : WELL.x + knobR + 0.55
            const knobCy = item.y + WELL.h / 2
            return (
              <g key={item.y}>
                <rect
                  x={WELL.x}
                  y={item.y}
                  width={WELL.w}
                  height={WELL.h}
                  rx={WELL.r}
                  fill="#12161c"
                />
                <rect
                  x={WELL.x + 0.4}
                  y={item.y + 0.85}
                  width={WELL.w - 0.85}
                  height={WELL.h - 1.2}
                  rx={WELL.r - 0.55}
                  fill={fill}
                />
                <rect
                  x={WELL.x + 1.3}
                  y={item.y + 0.95}
                  width={WELL.w - 2.6}
                  height="2.15"
                  rx="1.05"
                  fill={item.on ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.16)'}
                />
                {item.on ? (
                  <rect
                    x={WELL.x + 1.2}
                    y={item.y + WELL.h - 2.55}
                    width={WELL.w - 10.5}
                    height="1.15"
                    rx="0.55"
                    fill="rgba(10,50,20,0.28)"
                  />
                ) : null}
                <ellipse
                  cx={knobCx + 0.4}
                  cy={knobCy + 0.75}
                  rx={knobR + 0.15}
                  ry={knobR + 0.25}
                  fill="rgba(0,0,0,0.38)"
                />
                <circle cx={knobCx} cy={knobCy} r={knobR} fill={`url(#${knobFill})`} />
                <circle
                  cx={knobCx}
                  cy={knobCy}
                  r={knobR}
                  fill="none"
                  stroke="rgba(30,34,40,0.4)"
                  stroke-width="0.4"
                />
                <ellipse
                  cx={knobCx - 1.15}
                  cy={knobCy - 1.45}
                  rx="2.15"
                  ry="1.55"
                  fill="rgba(255,255,255,0.72)"
                />
                <ellipse
                  cx={knobCx + 0.35}
                  cy={knobCy + 2.15}
                  rx="2.6"
                  ry="1.15"
                  fill="rgba(40,44,50,0.16)"
                />
              </g>
            )
          })}
        </g>
      </svg>
    </AppIconTile>
  )
}
