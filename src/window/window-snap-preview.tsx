import type { SnapTarget } from './window-snap.ts'
import { getSnapBounds } from './window-snap.ts'
import './window-snap-preview.css'

type SnapPreviewProps = {
  target: SnapTarget | undefined
}

export function SnapPreview({ target }: SnapPreviewProps) {
  if (!target) return undefined

  const bounds = getSnapBounds(target)

  return (
    <div
      class={`snap-preview snap-preview--${target}`}
      style={{
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }}
      aria-hidden="true"
    />
  )
}
