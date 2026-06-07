import type { ComponentChildren } from 'preact'
import './app-icon-tile.css'

type AppIconTileProps = {
  color: string
  size?: number
  children: ComponentChildren
}

export function appIconBackground(color: string): string {
  return `linear-gradient(180deg, color-mix(in srgb, ${color} 70%, white) 0%, ${color} 48%, color-mix(in srgb, ${color} 65%, black) 100%)`
}

export function AppIconTile({ color, size = 72, children }: AppIconTileProps) {
  const radius = Math.round(size * 0.22)
  const glossHeight = Math.round(size * 0.4375)

  return (
    <span class="app-icon-tile" style={{ width: `${size}px`, height: `${size}px` }}>
      <span
        class="app-icon-tile__tile"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: `${radius}px`,
          background: appIconBackground(color),
        }}
      >
        <span
          class="app-icon-tile__gloss"
          style={{
            height: `${glossHeight}px`,
            borderRadius: `${radius}px ${radius}px 0 0`,
          }}
        />
        <span class="app-icon-tile__content">{children}</span>
      </span>
    </span>
  )
}
