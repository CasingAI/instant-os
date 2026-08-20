import { InstantLogoIcon } from '../../icons/app-icons.tsx'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'

export function WelcomeHelloIcon({ size = 64 }: { size?: number }) {
  const mark = Math.round(size * 0.42)
  return (
    <AppIconTile color="#3d4f8f" size={size}>
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          color: '#eef2ff',
          filter: 'drop-shadow(0 1px 2px rgba(12, 18, 40, 0.55))',
        }}
      >
        <InstantLogoIcon size={mark} />
      </span>
    </AppIconTile>
  )
}
