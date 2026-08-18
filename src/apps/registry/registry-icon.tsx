import { AppIconTile } from '../../icons/app-icon-tile.tsx'

type IconProps = {
  size?: number
}

export function RegistryIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#5b6d7f" size={size}>
      <svg
        width={Math.round(size * 0.7)}
        height={Math.round(size * 0.72)}
        viewBox="0 0 48 48"
        aria-hidden="true"
      >
        <ellipse cx="24" cy="9.5" rx="15" ry="6" fill="#ffffff" opacity="0.95" />
        <path
          d="M9 9.5 V33 C9 36.3 15.7 39 24 39 C32.3 39 39 36.3 39 33 V9.5"
          fill="none"
          stroke="#ffffff"
          stroke-width="3"
          opacity="0.85"
        />
        <path
          d="M9 21.5 C9 24.8 15.7 27.5 24 27.5 C32.3 27.5 39 24.8 39 21.5"
          fill="none"
          stroke="#ffffff"
          stroke-width="2.6"
          opacity="0.6"
        />
      </svg>
    </AppIconTile>
  )
}
