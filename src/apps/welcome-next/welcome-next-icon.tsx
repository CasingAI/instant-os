import { InstantLogoIcon } from '../../icons/app-icons.tsx'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'

export function WelcomeNextIcon({ size = 64 }: { size?: number }) {
  const mark = Math.round(size * 0.42)
  return (
    <AppIconTile color="#c9a36a" size={size}>
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          color: '#fff8ee',
          filter: 'drop-shadow(0 1px 2px rgba(80, 48, 8, 0.45))',
        }}
      >
        <InstantLogoIcon size={mark} />
      </span>
    </AppIconTile>
  )
}
