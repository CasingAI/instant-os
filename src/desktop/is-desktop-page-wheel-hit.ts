const DESKTOP_PAGE_WHEEL_BLOCK_SELECTOR = [
  '.window-frame',
  '.window-modal-overlay-root',
  '.menu-bar',
  '.dock__plate',
  '.desktop-folder-overlay',
  '.os-icon-context-menu',
  '.notification-center-overlay--open',
].join(',')

/** 指针落在窗口等表面时，触控板滑动应交给那些表面，而不是桌面翻页。 */
export function isDesktopPageWheelHit(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) {
    return true
  }
  return node.closest(DESKTOP_PAGE_WHEEL_BLOCK_SELECTOR) === null
}
