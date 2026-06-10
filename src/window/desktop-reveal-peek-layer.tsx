import { useOs } from '../os/os-context.tsx'
import type { WindowState } from '../os/types.ts'
import {
  getDesktopPeekScreenBounds,
  getDesktopRevealEdge,
} from './build-desktop-reveal-transform.ts'

function renderPeekStrip(window: WindowState, onRestore: () => void) {
  const bounds = {
    x: window.x,
    y: window.y,
    width: window.width,
    height: window.height,
  }
  const edge = getDesktopRevealEdge(bounds)
  const strip = getDesktopPeekScreenBounds(bounds, edge)

  if (strip.width <= 0 || strip.height <= 0) {
    return undefined
  }

  return (
    <button
      key={`desktop-peek-${window.id}`}
      type="button"
      class="desktop-reveal-peek-strip"
      aria-label="显示窗口"
      style={{
        left: `${strip.x}px`,
        top: `${strip.y}px`,
        width: `${strip.width}px`,
        height: `${strip.height}px`,
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onRestore()
      }}
    />
  )
}

export function DesktopRevealPeekLayer() {
  const { windows, desktopRevealed, hideDesktopReveal } = useOs()

  if (!desktopRevealed) {
    return undefined
  }

  const strips = windows
    .filter((window) => !window.minimized)
    .map((window) => renderPeekStrip(window, hideDesktopReveal))
    .filter((strip): strip is NonNullable<typeof strip> => strip !== undefined)

  if (strips.length === 0) {
    return undefined
  }

  return <div class="desktop-reveal-peek-layer">{strips}</div>
}
