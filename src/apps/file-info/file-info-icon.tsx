import { AppIconTile } from '../../icons/app-icon-tile.tsx'

type FileInfoIconProps = {
  size?: number
}

export function FileInfoIcon({ size = 72 }: FileInfoIconProps) {
  return (
    <AppIconTile color="#a67c42" size={size}>
      <span
        class="app-icon-tile__emoji"
        style={{
          position: 'relative',
          display: 'block',
          fontSize: `${size * (50 / 72)}px`,
        }}
      >
        ℹ️
      </span>
    </AppIconTile>
  )
}
