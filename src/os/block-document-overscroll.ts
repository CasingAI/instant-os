/**
 * 阻止 iOS/iPadOS Safari 把整页当橡皮筋拉开（露出 html/body 黑底）。
 *
 * 策略：仅当触摸点不在可滚动祖先内时 preventDefault；
 * 内部列表/面板的正常滚动与边界回弹不受影响。
 * 与 CSS `overscroll-behavior: none` 互补（CSS 拦连锁，这里拦「无人接手」的手势）。
 */

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function canElementScroll(el: HTMLElement): boolean {
  const style = getComputedStyle(el)
  const overflowY = style.overflowY
  const overflowX = style.overflowX
  const yScrollable =
    (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    el.scrollHeight > el.clientHeight + 1
  const xScrollable =
    (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
    el.scrollWidth > el.clientWidth + 1
  return yScrollable || xScrollable
}

function hasScrollableAncestor(target: EventTarget | null): boolean {
  let el: Element | null = target instanceof Element ? target : null
  while (el && el !== document.documentElement && el !== document.body) {
    if (el instanceof HTMLElement && canElementScroll(el)) {
      return true
    }
    el = el.parentElement
  }
  return false
}

export function blockDocumentOverscroll(): void {
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length !== 1 || event.defaultPrevented) {
        return
      }
      if (isEditableTarget(event.target)) {
        return
      }
      if (hasScrollableAncestor(event.target)) {
        return
      }
      event.preventDefault()
    },
    { passive: false, capture: true },
  )
}
