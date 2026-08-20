import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

type TileSpec = {
  x: number
  y: number
  w: number
  h: number
  r: number
  thick: number
}

function svgUid(rawId: string, suffix: string): string {
  return `space-sniffer-icon-${suffix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
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

const GROUP_TF = 'translate(32 32.5) rotate(-3.5) translate(-32 -32.5)'

const TILE_A: TileSpec = { x: 9.2, y: 10.4, w: 26.6, h: 22.6, r: 2.2, thick: 1.9 }
const TILE_B: TileSpec = { x: 37.95, y: 10.4, w: 17.05, h: 10.2, r: 1.8, thick: 1.22 }
const TILE_C: TileSpec = { x: 37.95, y: 22.75, w: 17.05, h: 10.25, r: 1.8, thick: 1.08 }
const TILE_D: TileSpec = { x: 9.2, y: 35.15, w: 16.1, h: 16.65, r: 2.0, thick: 1.52 }
const TILE_E: TileSpec = { x: 27.45, y: 35.15, w: 27.55, h: 16.65, r: 2.0, thick: 1.38 }

const INNER_A1: TileSpec = { x: 10.85, y: 12.05, w: 11.7, h: 10.0, r: 1.3, thick: 0.82 }
const INNER_A2: TileSpec = { x: 24.1, y: 12.05, w: 10.05, h: 10.0, r: 1.3, thick: 0.7 }
const INNER_A3: TileSpec = { x: 10.85, y: 23.6, w: 23.3, h: 7.75, r: 1.3, thick: 0.76 }

const OUTER_TILES = [TILE_A, TILE_B, TILE_C, TILE_D, TILE_E] as const
const INNER_TILES = [INNER_A1, INNER_A2, INNER_A3] as const

function sideTransform(tile: TileSpec): string {
  return `translate(${(tile.thick * 0.52).toFixed(2)} ${tile.thick.toFixed(2)})`
}

function TileFace({
  tile,
  faceId,
  highlight = 0.4,
  shade = 0.18,
}: {
  tile: TileSpec
  faceId: string
  highlight?: number
  shade?: number
}) {
  const { x, y, w, h, r } = tile
  const path = roundedRectPath(x, y, w, h, r)
  const clipId = `${faceId}-clip`
  const hiH = Math.max(0.95, h * 0.13)
  const shH = Math.max(0.8, h * 0.14)
  return (
    <g>
      <clipPath id={clipId}>
        <path d={path} />
      </clipPath>
      <path
        d={path}
        fill={`url(#${faceId})`}
        stroke="rgba(8,42,58,0.34)"
        stroke-width="0.4"
      />
      <g clip-path={`url(#${clipId})`}>
        <rect
          x={x + 0.55}
          y={y + 0.4}
          width={w - 1.1}
          height={hiH}
          fill={`rgba(255,255,255,${highlight})`}
        />
        <ellipse
          cx={x + w * 0.28}
          cy={y + h * 0.22}
          rx={w * 0.22}
          ry={h * 0.16}
          fill="rgba(255,255,255,0.16)"
        />
        <rect
          x={x + 0.55}
          y={y + h - shH}
          width={w - 1.1}
          height={shH}
          fill={`rgba(6,40,58,${shade})`}
        />
        <path
          d={`M ${(x + 0.85).toFixed(2)} ${(y + 0.95).toFixed(2)} V ${(y + h - 0.95).toFixed(2)}`}
          fill="none"
          stroke="rgba(255,255,255,0.32)"
          stroke-width="0.7"
          stroke-linecap="round"
        />
      </g>
    </g>
  )
}

/**
 * 立体树图块：不同高度的玻璃砖拼成磁盘占用图，
 * 大块里再嵌一层，对应空间嗅探的下钻。
 */
export function SpaceSnifferIcon({ size = 64 }: IconProps) {
  const rawId = useId()
  const shadow = svgUid(rawId, 'shadow')
  const innerShadow = svgUid(rawId, 'inner-shadow')
  const faceA = svgUid(rawId, 'face-a')
  const faceB = svgUid(rawId, 'face-b')
  const faceC = svgUid(rawId, 'face-c')
  const faceD = svgUid(rawId, 'face-d')
  const faceE = svgUid(rawId, 'face-e')
  const faceA1 = svgUid(rawId, 'face-a1')
  const faceA2 = svgUid(rawId, 'face-a2')
  const faceA3 = svgUid(rawId, 'face-a3')
  const sideA = svgUid(rawId, 'side-a')
  const sideB = svgUid(rawId, 'side-b')
  const sideC = svgUid(rawId, 'side-c')
  const sideD = svgUid(rawId, 'side-d')
  const sideE = svgUid(rawId, 'side-e')
  const sideInner = svgUid(rawId, 'side-in')

  const outerFaces = [faceA, faceB, faceC, faceD, faceE]
  const outerSides = [sideA, sideB, sideC, sideD, sideE]
  const innerFaces = [faceA1, faceA2, faceA3]

  return (
    <AppIconTile color="#0e7490" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <filter id={shadow} x="-40%" y="-25%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="blur" />
            <feOffset dx="0.7" dy="1.7" result="off" />
            <feFlood flood-color="#04303c" flood-opacity="0.55" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <filter id={innerShadow} x="-30%" y="-25%" width="160%" height="165%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.55" result="blur" />
            <feOffset dx="0.35" dy="0.7" result="off" />
            <feFlood flood-color="#044556" flood-opacity="0.42" result="color" />
            <feComposite in="color" in2="off" operator="in" result="drop" />
            <feMerge>
              <feMergeNode in="drop" />
            </feMerge>
          </filter>
          <linearGradient id={faceA} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#e8fffb" />
            <stop offset="28%" stop-color="#7ef0e4" />
            <stop offset="62%" stop-color="#2dd4bf" />
            <stop offset="100%" stop-color="#0f9a8a" />
          </linearGradient>
          <linearGradient id={sideA} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0e7a72" />
            <stop offset="100%" stop-color="#064e49" />
          </linearGradient>
          <linearGradient id={faceB} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#d9f8ff" />
            <stop offset="36%" stop-color="#5ee4f8" />
            <stop offset="100%" stop-color="#0891b2" />
          </linearGradient>
          <linearGradient id={sideB} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0e7490" />
            <stop offset="100%" stop-color="#155e75" />
          </linearGradient>
          <linearGradient id={faceC} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f4feff" />
            <stop offset="42%" stop-color="#a5f3fc" />
            <stop offset="100%" stop-color="#67e8f9" />
          </linearGradient>
          <linearGradient id={sideC} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#22a0b8" />
            <stop offset="100%" stop-color="#0e6a7a" />
          </linearGradient>
          <linearGradient id={faceD} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#b8f7ea" />
            <stop offset="38%" stop-color="#2dd4bf" />
            <stop offset="100%" stop-color="#0d9488" />
          </linearGradient>
          <linearGradient id={sideD} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0f766e" />
            <stop offset="100%" stop-color="#115e59" />
          </linearGradient>
          <linearGradient id={faceE} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#9aeefc" />
            <stop offset="40%" stop-color="#22d3ee" />
            <stop offset="100%" stop-color="#0e7490" />
          </linearGradient>
          <linearGradient id={sideE} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#155e75" />
            <stop offset="100%" stop-color="#0c4a5c" />
          </linearGradient>
          <linearGradient id={faceA1} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="34%" stop-color="#c6fff4" />
            <stop offset="100%" stop-color="#5eead4" />
          </linearGradient>
          <linearGradient id={faceA2} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#e0fbff" />
            <stop offset="40%" stop-color="#7dd3fc" />
            <stop offset="100%" stop-color="#38bdf8" />
          </linearGradient>
          <linearGradient id={faceA3} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#bbf7d0" />
            <stop offset="45%" stop-color="#34d399" />
            <stop offset="100%" stop-color="#059669" />
          </linearGradient>
          <linearGradient id={sideInner} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0f766e" />
            <stop offset="100%" stop-color="#115e59" />
          </linearGradient>
        </defs>

        <g transform={GROUP_TF}>
          <g filter={`url(#${shadow})`}>
            {OUTER_TILES.map((tile) => (
              <path key={`${tile.x}-${tile.y}`} d={roundedRectPath(tile.x, tile.y, tile.w, tile.h, tile.r)} fill="#000" />
            ))}
          </g>

          {OUTER_TILES.map((tile, i) => (
            <g key={`side-${tile.x}-${tile.y}`} transform={sideTransform(tile)} opacity="0.95">
              <path d={roundedRectPath(tile.x, tile.y, tile.w, tile.h, tile.r)} fill={`url(#${outerSides[i]})`} />
            </g>
          ))}

          {OUTER_TILES.map((tile, i) => (
            <TileFace
              key={`face-${tile.x}-${tile.y}`}
              tile={tile}
              faceId={outerFaces[i]}
              highlight={i === 2 ? 0.5 : 0.38}
              shade={i === 2 ? 0.1 : 0.17}
            />
          ))}

          <g filter={`url(#${innerShadow})`}>
            {INNER_TILES.map((tile) => (
              <path key={`${tile.x}-${tile.y}`} d={roundedRectPath(tile.x, tile.y, tile.w, tile.h, tile.r)} fill="#000" />
            ))}
          </g>
          {INNER_TILES.map((tile) => (
            <g key={`in-side-${tile.x}-${tile.y}`} transform={sideTransform(tile)} opacity="0.9">
              <path d={roundedRectPath(tile.x, tile.y, tile.w, tile.h, tile.r)} fill={`url(#${sideInner})`} />
            </g>
          ))}
          {INNER_TILES.map((tile, i) => (
            <TileFace
              key={`in-face-${tile.x}-${tile.y}`}
              tile={tile}
              faceId={innerFaces[i]}
              highlight={0.46}
              shade={0.14}
            />
          ))}
        </g>
      </svg>
    </AppIconTile>
  )
}
