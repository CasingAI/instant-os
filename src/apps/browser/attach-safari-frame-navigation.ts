import type { SafariContextMenuTarget } from './safari-context-menu.tsx'
import {
  buildFormNavigationUrl,
  isEmbeddedAppOrigin,
  resolveBrowserNavigationUrl,
  resolveFrameImageUrl,
  resolveFrameLinkUrl,
} from './resolve-browser-navigation-url.ts'

export type SafariFrameContextMenuRequest = {
  x: number
  y: number
  target: SafariContextMenuTarget
}

function eventTargetElement(target: EventTarget | null): Element | undefined {
  if (!target || typeof target !== 'object' || !('nodeType' in target)) {
    return undefined
  }

  const node = target as Node

  if (node.nodeType === 1) {
    return target as Element
  }

  if (node.nodeType === 3) {
    return (target as Text).parentElement ?? undefined
  }

  return undefined
}

export function attachSafariFrameNavigation(
  doc: Document,
  getPageBaseUrl: () => string,
  onNavigate: (url: string) => void,
  onFocus?: () => void,
  onContextMenu?: (request: SafariFrameContextMenuRequest) => void,
): () => void {
  const emitNavigate = (url: string) => {
    if (isEmbeddedAppOrigin(url)) {
      return
    }
    onNavigate(url)
  }

  const onClick = (event: Event) => {
    const element = eventTargetElement(event.target)
    if (!element) {
      return
    }

    const link = element.closest('a[href]')
    if (link) {
      const url = resolveFrameLinkUrl(link, getPageBaseUrl())
      if (url) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        emitNavigate(url)
      }
      return
    }

    const button = element.closest('button')
    if (!button || button.type === 'submit') {
      return
    }

    const navUrl = button.getAttribute('data-navigate-url')
    if (navUrl) {
      const url = resolveBrowserNavigationUrl(navUrl, getPageBaseUrl())
      if (url) {
        event.preventDefault()
        event.stopPropagation()
        emitNavigate(url)
      }
    }
  }

  const onSubmit = (event: Event) => {
    const element = eventTargetElement(event.target)
    const form = element?.closest('form')

    if (!form) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const url = buildFormNavigationUrl(form, getPageBaseUrl())
    if (url) {
      emitNavigate(url)
    }
  }

  const onPointerDown = () => {
    onFocus?.()
  }

  const resolveContextTarget = (element: Element): SafariContextMenuTarget => {
    const pageBaseUrl = getPageBaseUrl()

    const link = element.closest('a[href]')
    if (link) {
      const url = resolveFrameLinkUrl(link, pageBaseUrl)
      if (url) {
        return { kind: 'link', url }
      }
    }

    const image = element.closest('img[src]')
    if (image) {
      const url = resolveFrameImageUrl(image, pageBaseUrl)
      if (url) {
        return { kind: 'image', url }
      }
    }

    return { kind: 'page' }
  }

  const onContextMenuEvent = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    onFocus?.()

    const mouseEvent = event as MouseEvent
    const element = eventTargetElement(mouseEvent.target)
    const contextTarget = element
      ? resolveContextTarget(element)
      : ({ kind: 'page' } as const)

    onContextMenu?.({
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      target: contextTarget,
    })
  }

  doc.addEventListener('click', onClick, true)
  doc.addEventListener('submit', onSubmit, true)
  doc.addEventListener('pointerdown', onPointerDown, true)
  doc.addEventListener('contextmenu', onContextMenuEvent, true)

  return () => {
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('submit', onSubmit, true)
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.removeEventListener('contextmenu', onContextMenuEvent, true)
  }
}
