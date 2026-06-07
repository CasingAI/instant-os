import { AppIconTile } from '../../icons/app-icon-tile.tsx'
import { DownloadProgressOverlay } from './download-progress-overlay.tsx'
import './generated-app-icon.css'

type GeneratedAppIconProps = {
  emoji: string
  themeColor: string
  size?: number
  progress?: number
  textLength?: number
}

export function GeneratedAppIcon({
  emoji,
  themeColor,
  size = 72,
  progress,
  textLength,
}: GeneratedAppIconProps) {
  const downloading = progress !== undefined && progress < 100

  return (
    <span
      class={`generated-app-icon${downloading ? ' generated-app-icon--downloading' : ''}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <span class="generated-app-icon__base">
        <AppIconTile color={themeColor} size={size}>
          <span class="generated-app-icon__emoji" style={{ fontSize: `${size * (50 / 72)}px` }}>
            {emoji}
          </span>
        </AppIconTile>
      </span>
      {downloading && progress !== undefined && (
        <DownloadProgressOverlay progress={progress} size={size} textLength={textLength} />
      )}
    </span>
  )
}
