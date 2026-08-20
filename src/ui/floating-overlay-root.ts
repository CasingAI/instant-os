const FLOATING_OVERLAY_ROOT_ID = 'instant-os-floating-overlays'
const CURSOR_SYNC_ATTR = 'data-floating-cursor-sync'

/**
 * Chromium：祖先 `pointer-events: none` + 子级 `auto` 时，子树里的 `cursor`
 * 常常不反映到系统指针（仍显示下层箭头）。把命中元素的 computed cursor
 * 写回 pe:auto 宿主，指针才会变。
 */
function ensureFloatingOverlayCursorSync(root: HTMLElement): void {
  if (root.getAttribute(CURSOR_SYNC_ATTR) === '1') {
    return
  }
  root.setAttribute(CURSOR_SYNC_ATTR, '1')

  const hostFor = (node: EventTarget | null): HTMLElement | undefined => {
    let current: Element | null =
      node instanceof Element ? node : node instanceof Text ? node.parentElement : null
    while (current && current.parentElement !== root) {
      current = current.parentElement
    }
    return current instanceof HTMLElement ? current : undefined
  }

  root.addEventListener(
    'pointermove',
    (event) => {
      const host = hostFor(event.target)
      if (!host) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const computed = getComputedStyle(target).cursor
      const next = !computed || computed === 'auto' ? 'default' : computed
      if (host.style.getPropertyValue('cursor') !== next) {
        host.style.setProperty('cursor', next)
      }
    },
    { passive: true },
  )

  root.addEventListener(
    'pointerout',
    (event) => {
      const host = hostFor(event.target)
      if (!host) {
        return
      }
      const related = event.relatedTarget
      if (related instanceof Node && host.contains(related)) {
        return
      }
      host.style.removeProperty('cursor')
    },
    { passive: true },
  )
}

export function getFloatingOverlayRoot(): HTMLElement {
  const existing = document.getElementById(FLOATING_OVERLAY_ROOT_ID)
  if (existing) {
    ensureFloatingOverlayCursorSync(existing)
    return existing
  }

  const root = document.createElement('div')
  root.id = FLOATING_OVERLAY_ROOT_ID
  root.className = 'floating-overlay-root'
  document.body.appendChild(root)
  ensureFloatingOverlayCursorSync(root)
  return root
}
