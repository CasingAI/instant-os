import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

function svgUid(rawId: string, suffix: string): string {
  return `settings-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
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

function gearTeethPath(
  cx: number,
  cy: number,
  teeth: number,
  rTip: number,
  rRoot: number,
  rotation: number,
): string {
  const parts: string[] = []
  for (let i = 0; i < teeth; i++) {
    const mid = rotation - Math.PI / 2 + (i / teeth) * Math.PI * 2
    const pitch = (Math.PI * 2) / teeth
    const [lx, ly] = polar(cx, cy, rRoot, mid - pitch * 0.46)
    const [tx1, ty1] = polar(cx, cy, rTip, mid - pitch * 0.11)
    const [tx2, ty2] = polar(cx, cy, rTip, mid + pitch * 0.11)
    const [rx, ry] = polar(cx, cy, rRoot, mid + pitch * 0.46)
    const cmd = i === 0 ? 'M' : 'L'
    parts.push(
      `${cmd} ${lx.toFixed(2)} ${ly.toFixed(2)} L ${tx1.toFixed(2)} ${ty1.toFixed(2)} L ${tx2.toFixed(2)} ${ty2.toFixed(2)} L ${rx.toFixed(2)} ${ry.toFixed(2)}`,
    )
  }
  parts.push('Z')
  return parts.join(' ')
}

function ringHolePath(cx: number, cy: number, r: number): string {
  return `M ${(cx + r).toFixed(2)} ${cy.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(cx - r).toFixed(2)} ${cy.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(cx + r).toFixed(2)} ${cy.toFixed(2)} Z`
}

function spokeWindowsPath(
  cx: number,
  cy: number,
  rHub: number,
  rRim: number,
  spokeCount: number,
  spokeWidth: number,
  rotation: number,
): string {
  const parts: string[] = []
  const step = (Math.PI * 2) / spokeCount
  for (let i = 0; i < spokeCount; i++) {
    const spokeMid = rotation - Math.PI / 2 + i * step
    const a0 = spokeMid + spokeWidth / 2
    const a1 = spokeMid + step - spokeWidth / 2
    const sweep = a1 - a0
    const large = sweep > Math.PI ? 1 : 0
    const [x0, y0] = polar(cx, cy, rRim, a0)
    const [x1, y1] = polar(cx, cy, rRim, a1)
    const [x2, y2] = polar(cx, cy, rHub, a1)
    const [x3, y3] = polar(cx, cy, rHub, a0)
    parts.push(
      `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rRim.toFixed(2)} ${rRim.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${rHub.toFixed(2)} ${rHub.toFixed(2)} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`,
    )
  }
  return parts.join(' ')
}

function donutGearPath(
  cx: number,
  cy: number,
  teeth: number,
  rTip: number,
  rRoot: number,
  rHole: number,
  rotation: number,
): string {
  return `${gearTeethPath(cx, cy, teeth, rTip, rRoot, rotation)} ${ringHolePath(cx, cy, rHole)}`
}

function spokedGearPath(
  cx: number,
  cy: number,
  teeth: number,
  rTip: number,
  rRoot: number,
  rRim: number,
  rHub: number,
  spokeCount: number,
  spokeWidth: number,
  rotation: number,
): string {
  return `${gearTeethPath(cx, cy, teeth, rTip, rRoot, rotation)} ${spokeWindowsPath(cx, cy, rHub, rRim, spokeCount, spokeWidth, rotation)}`
}

/** iOS 6 设置：穿孔铝板 + 主齿轮 + 底角只露出 1/4～1/3 的小齿轮 */
export function SettingsIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const plateGrad = svgUid(rawId, 'plate')
  const plateRadial = svgUid(rawId, 'plate-radial')
  const perforation = svgUid(rawId, 'perf')
  const bezelGrad = svgUid(rawId, 'bezel')
  const mainFill = svgUid(rawId, 'main-fill')
  const mainSide = svgUid(rawId, 'main-side')
  const smallFill = svgUid(rawId, 'small-fill')
  const smallSide = svgUid(rawId, 'small-side')
  const hubFill = svgUid(rawId, 'hub')
  const glossGrad = svgUid(rawId, 'gloss')
  const mainClip = svgUid(rawId, 'main-clip')
  const leftClip = svgUid(rawId, 'left-clip')
  const rightClip = svgUid(rawId, 'right-clip')
  const wellClip = svgUid(rawId, 'well-clip')
  const gearBlur = svgUid(rawId, 'gear-blur')

  const well = { x: 4.2, y: 4.2, w: 55.6, h: 55.6, r: 10.6 }
  const wellPath = roundedRectPath(well.x, well.y, well.w, well.h, well.r)

  const main = { cx: 32, cy: 27.6, rot: 0.2 }
  const left = { cx: 6.8, cy: 57.2, rot: 0.45 }
  const right = { cx: 57.4, cy: 58, rot: 0.12 }

  const mainPath = spokedGearPath(main.cx, main.cy, 16, 25.8, 20.3, 16.95, 7.3, 3, 0.72, main.rot)
  const leftPath = donutGearPath(left.cx, left.cy, 14, 17.6, 13.5, 5.2, left.rot)
  const rightPath = donutGearPath(right.cx, right.cy, 14, 16.4, 12.55, 4.85, right.rot)

  return (
    <AppIconTile color="#4c4c52" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id={plateGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6e6e74" />
            <stop offset="55%" stop-color="#4a4a50" />
            <stop offset="100%" stop-color="#2c2c32" />
          </linearGradient>
          <radialGradient id={plateRadial} cx="46%" cy="38%" r="62%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.16)" />
            <stop offset="100%" stop-color="rgba(0,0,0,0.22)" />
          </radialGradient>
          <pattern id={perforation} width="6.2" height="5.37" patternUnits="userSpaceOnUse">
            <circle cx="3.1" cy="1.34" r="1.08" fill="#16161a" />
            <circle cx="0" cy="4.03" r="1.08" fill="#16161a" />
            <circle cx="6.2" cy="4.03" r="1.08" fill="#16161a" />
          </pattern>
          <linearGradient id={bezelGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ececf0" />
            <stop offset="42%" stop-color="#b8b8be" />
            <stop offset="100%" stop-color="#6e6e76" />
          </linearGradient>
          <linearGradient id={mainFill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#dcdce2" />
            <stop offset="36%" stop-color="#9a9aa2" />
            <stop offset="100%" stop-color="#4e4e56" />
          </linearGradient>
          <linearGradient id={mainSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#5a5a62" />
            <stop offset="100%" stop-color="#242428" />
          </linearGradient>
          <linearGradient id={smallFill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f6f6f8" />
            <stop offset="45%" stop-color="#c8c8ce" />
            <stop offset="100%" stop-color="#84848c" />
          </linearGradient>
          <linearGradient id={smallSide} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7a7a82" />
            <stop offset="100%" stop-color="#3a3a42" />
          </linearGradient>
          <radialGradient id={hubFill} cx="42%" cy="32%" r="68%">
            <stop offset="0%" stop-color="#cfcfd6" />
            <stop offset="55%" stop-color="#8d8d95" />
            <stop offset="100%" stop-color="#4f4f57" />
          </radialGradient>
          <linearGradient id={glossGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(255,255,255,0.3)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0)" />
          </linearGradient>
          <clipPath id={wellClip}>
            <path d={wellPath} />
          </clipPath>
          <clipPath id={mainClip}>
            <path d={mainPath} fill-rule="evenodd" />
          </clipPath>
          <clipPath id={leftClip}>
            <path d={leftPath} fill-rule="evenodd" />
          </clipPath>
          <clipPath id={rightClip}>
            <path d={rightPath} fill-rule="evenodd" />
          </clipPath>
          <filter id={gearBlur} x="-40%" y="-20%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.45" result="blur" />
            <feOffset dy="1.1" result="off" />
            <feFlood flood-color="#000" flood-opacity="0.55" result="color" />
            <feComposite in="color" in2="off" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
            </feMerge>
          </filter>
        </defs>

        <g clip-path={`url(#${wellClip})`}>
          <rect width="64" height="64" fill={`url(#${plateGrad})`} />
          <rect width="64" height="64" fill={`url(#${plateRadial})`} />
          <rect width="64" height="64" fill={`url(#${perforation})`} opacity="0.72" />

          <rect
            x={well.x}
            y={well.y}
            width={well.w}
            height={well.h}
            rx={well.r}
            ry={well.r}
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            stroke-width="6"
          />

          <g filter={`url(#${gearBlur})`}>
            <path d={mainPath} fill="#000" fill-rule="evenodd" />
          </g>
          <path d={mainPath} fill="#000" fill-rule="evenodd" opacity="0.32" transform="translate(0 1.35)" />
          <path d={mainPath} fill={`url(#${mainSide})`} fill-rule="evenodd" transform="translate(0 1.75)" />
          <path
            d={mainPath}
            fill={`url(#${mainFill})`}
            fill-rule="evenodd"
            stroke="rgba(20,20,24,0.4)"
            stroke-width="0.5"
          />
          <g clip-path={`url(#${mainClip})`}>
            <ellipse cx={main.cx} cy={main.cy - 9.5} rx="19" ry="12.5" fill="rgba(255,255,255,0.38)" />
            <ellipse cx={main.cx} cy={main.cy + 14} rx="17.5" ry="10" fill="rgba(0,0,0,0.22)" />
          </g>

          <circle cx={main.cx} cy={main.cy} r="7.2" fill={`url(#${hubFill})`} />
          <circle
            cx={main.cx}
            cy={main.cy}
            r="7.2"
            fill="none"
            stroke="rgba(255,255,255,0.32)"
            stroke-width="0.6"
          />
          <circle cx={main.cx} cy={main.cy} r="4.9" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="0.7" />
          <circle cx={main.cx} cy={main.cy + 0.2} r="2.65" fill="#3a3a42" />
          <circle
            cx={main.cx}
            cy={main.cy - 0.35}
            r="2.65"
            fill="none"
            stroke="rgba(255,255,255,0.28)"
            stroke-width="0.5"
          />
          <circle cx={main.cx} cy={main.cy} r="1" fill="#1a1a1e" />

          <g filter={`url(#${gearBlur})`}>
            <path d={leftPath} fill="#000" fill-rule="evenodd" />
            <path d={rightPath} fill="#000" fill-rule="evenodd" />
          </g>
          <path d={leftPath} fill="#000" fill-rule="evenodd" opacity="0.28" transform="translate(0 1.15)" />
          <path d={rightPath} fill="#000" fill-rule="evenodd" opacity="0.28" transform="translate(0 1.15)" />

          <path d={leftPath} fill={`url(#${smallSide})`} fill-rule="evenodd" transform="translate(0 1.55)" />
          <path
            d={leftPath}
            fill={`url(#${smallFill})`}
            fill-rule="evenodd"
            stroke="rgba(0,0,0,0.32)"
            stroke-width="0.45"
          />
          <g clip-path={`url(#${leftClip})`}>
            <ellipse cx={left.cx} cy={left.cy - 8} rx="13" ry="9" fill="rgba(255,255,255,0.42)" />
            <ellipse cx={left.cx} cy={left.cy + 8} rx="12" ry="8" fill="rgba(0,0,0,0.2)" />
          </g>

          <path d={rightPath} fill={`url(#${smallSide})`} fill-rule="evenodd" transform="translate(0 1.55)" />
          <path
            d={rightPath}
            fill={`url(#${smallFill})`}
            fill-rule="evenodd"
            stroke="rgba(0,0,0,0.32)"
            stroke-width="0.45"
          />
          <g clip-path={`url(#${rightClip})`}>
            <ellipse cx={right.cx} cy={right.cy - 7.5} rx="12" ry="8.4" fill="rgba(255,255,255,0.42)" />
            <ellipse cx={right.cx} cy={right.cy + 7.5} rx="11" ry="7.4" fill="rgba(0,0,0,0.2)" />
          </g>
        </g>

        <path
          d={`${roundedRectPath(0, 0, 64, 64, 14)} ${wellPath}`}
          fill={`url(#${bezelGrad})`}
          fill-rule="evenodd"
        />
        <rect
          x={well.x}
          y={well.y}
          width={well.w}
          height={well.h}
          rx={well.r}
          ry={well.r}
          fill="none"
          stroke="rgba(0,0,0,0.42)"
          stroke-width="0.8"
        />
        <rect
          x={well.x + 0.2}
          y={well.y - 0.25}
          width={well.w - 0.4}
          height={well.h}
          rx={well.r}
          ry={well.r}
          fill="none"
          stroke="rgba(255,255,255,0.38)"
          stroke-width="0.55"
        />
        <rect
          x="0.55"
          y="0.55"
          width="62.9"
          height="62.9"
          rx="13.6"
          ry="13.6"
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          stroke-width="0.7"
        />

        <rect width="64" height="28" fill={`url(#${glossGrad})`} />
      </svg>
    </AppIconTile>
  )
}
