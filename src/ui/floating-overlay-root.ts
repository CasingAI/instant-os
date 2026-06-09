const FLOATING_OVERLAY_ROOT_ID = 'instant-os-floating-overlays'

export function getFloatingOverlayRoot(): HTMLElement {
  const existing = document.getElementById(FLOATING_OVERLAY_ROOT_ID)
  if (existing) {
    return existing
  }

  const root = document.createElement('div')
  root.id = FLOATING_OVERLAY_ROOT_ID
  root.className = 'floating-overlay-root'
  document.body.appendChild(root)
  return root
}
