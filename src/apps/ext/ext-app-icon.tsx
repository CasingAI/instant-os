import { AppIconTile } from '../../icons/app-icon-tile.tsx'
import './ext-app-icon.css'

type ExtAppIconProps = {
  name: string
  themeColor: string
  iconUrl?: string
  size?: number
  devBadge?: boolean
}

function readIconLabel(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    return '外'
  }
  return trimmed.slice(0, 1)
}

export function ExtAppIcon({
  name,
  themeColor,
  iconUrl,
  size = 72,
  devBadge = false,
}: ExtAppIconProps) {
  return (
    <span class="ext-app-icon" style={{ width: `${size}px`, height: `${size}px` }}>
      <span class="ext-app-icon__base">
        <AppIconTile color={themeColor} size={size}>
          {iconUrl ? (
            <img
              class="ext-app-icon__image"
              src={iconUrl}
              alt=""
              width={size}
              height={size}
              draggable={false}
            />
          ) : (
            <span class="ext-app-icon__label" style={{ fontSize: `${size * (50 / 72)}px` }}>
              {readIconLabel(name)}
            </span>
          )}
        </AppIconTile>
      </span>
      {devBadge ? <span class="ext-app-icon__dev-badge">DEV</span> : undefined}
    </span>
  )
}
