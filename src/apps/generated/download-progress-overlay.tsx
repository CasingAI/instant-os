import { formatTextLengthK } from '../appstore/format-text-length.ts'
import './generated-app-icon.css'

type DownloadProgressOverlayProps = {
  progress: number
  size?: number
  textLength?: number
}

export function DownloadProgressOverlay({
  progress,
  size = 72,
  textLength,
}: DownloadProgressOverlayProps) {
  const clamped = Math.max(0, Math.min(100, progress))
  const barWidth = Math.round(size * 0.78)
  const barHeight = Math.max(5, Math.round(size * 0.09))
  const showLength = textLength !== undefined && textLength > 0

  return (
    <span
      class="download-progress"
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-label={`下载中 ${Math.round(clamped)}%`}
    >
      <span class="download-progress__dim" />
      {showLength && (
        <span
          class="download-progress__length"
          style={{ fontSize: `${Math.max(11, Math.round(size * 0.17))}px` }}
        >
          {formatTextLengthK(textLength)}
        </span>
      )}
      <span
        class="download-progress__bar"
        style={{
          width: `${barWidth}px`,
          height: `${barHeight}px`,
          bottom: `${Math.round(size * 0.1)}px`,
        }}
      >
        <span
          class="download-progress__fill"
          style={{ width: `${clamped}%` }}
        />
      </span>
      {clamped >= 100 && <span class="download-progress__check">✓</span>}
    </span>
  )
}
