import { AppIconTile } from '../../icons/app-icon-tile.tsx'

export function AttuneBenchIcon({ size = 64 }: { size?: number }) {
  return (
    <AppIconTile color="#e0526e" size={size}>
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        fill="none"
        aria-hidden="true"
      >
        {/* 心形（情绪） */}
        <path
          d="M32 51 C 30 49.5 18 40 18 30 C 18 23.5 23 19.5 28.5 19.5 C 30.5 19.5 31.5 20.5 32 21 C 32.5 20.5 33.5 19.5 35.5 19.5 C 41 19.5 46 23.5 46 30 C 46 40 34 49.5 32 51 z"
          fill="#ffffff"
          stroke="#8c2b44"
          stroke-width="1.6"
        />
        {/* 评分标尺 */}
        <rect x="10" y="11" width="44" height="8" rx="4" fill="#f7cdd8" />
        <rect x="12" y="13" width="18" height="4" rx="2" fill="#e0526e" />
        <circle cx="44" cy="15" r="3" fill="#ffffff" stroke="#8c2b44" stroke-width="1.4" />
        <path
          d="M43 15 l2 2.5 l-1.5 -1.5 l-2 2.5 M45.5 13.5 l1.5 2 l-1 -1 l-1.5 2"
          stroke="#8c2b44"
          stroke-width="0.9"
          stroke-linecap="round"
          fill="none"
        />
      </svg>
    </AppIconTile>
  )
}
