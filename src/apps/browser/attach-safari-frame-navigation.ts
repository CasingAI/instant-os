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
  /** iframe 内事件不冒泡到父窗口；用于关闭叠在页面上的自定义菜单 */
  onDismissOverlay?: () => void,
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
      // 必须先阻止默认行为：href="#" / 空 href 会被注入的 <base> 解析成真实站并离开 iframe
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      const url = resolveFrameLinkUrl(link, getPageBaseUrl())
      if (url) {
        emitNavigate(url)
        return
      }

      const hrefAttr = (link.getAttribute('href') ?? '').trim()
      if (hrefAttr.startsWith('#') && hrefAttr.length > 1) {
        try {
          const id = decodeURIComponent(hrefAttr.slice(1))
          if (id) {
            doc.getElementById(id)?.scrollIntoView()
          }
        } catch {
          // ignore malformed hash
        }
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

  const onPointerDown = (event: Event) => {
    onFocus?.()
    // 右键留给 contextmenu 打开菜单；左键等需主动关闭（父窗口听不到 iframe 内 pointerdown）
    if ((event as PointerEvent).button !== 2) {
      onDismissOverlay?.()
    }
  }

  const onKeyDown = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      onDismissOverlay?.()
    }
  }

  const onScroll = () => {
    onDismissOverlay?.()
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
  doc.addEventListener('keydown', onKeyDown, true)
  doc.addEventListener('scroll', onScroll, true)
  doc.addEventListener('contextmenu', onContextMenuEvent, true)

  return () => {
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('submit', onSubmit, true)
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.removeEventListener('keydown', onKeyDown, true)
    doc.removeEventListener('scroll', onScroll, true)
    doc.removeEventListener('contextmenu', onContextMenuEvent, true)
  }
}
