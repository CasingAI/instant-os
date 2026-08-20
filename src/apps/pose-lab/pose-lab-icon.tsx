import { AppIconTile } from '../../icons/app-icon-tile.tsx'

type IconProps = {
  size?: number
}

export function PoseLabIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#0a84ff" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M14 28 L42 18 L50 38 L22 48 Z"
          fill="rgba(255,255,255,0.92)"
        />
        <path
          d="M14 28 L42 18 L50 38 L22 48 Z"
          fill="none"
          stroke="rgba(10,40,90,0.35)"
          stroke-width="1.4"
        />
        <path d="M18 30 L38 22" stroke="#ff375f" stroke-width="1.6" stroke-dasharray="3 2" />
        <path d="M38 22 L26 44" stroke="#5ac8fa" stroke-width="1.6" stroke-dasharray="3 2" />
      </svg>
    </AppIconTile>
  )
}
