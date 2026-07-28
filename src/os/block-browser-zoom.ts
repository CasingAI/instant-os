/**
 * 阻止整页缩放（模拟桌面 OS 时不应放大浏览器视口）：
 * - iOS Safari / iPad：gesture* 与多指 touchmove
 * - macOS 桌面浏览器触控板捏合：wheel + ctrlKey（Chrome/Edge/Firefox）
 * 不拦截键盘 ⌘+/⌘- 缩放。
 */
export function blockBrowserZoom(): void {
  const blockGesture = (event: Event) => {
    event.preventDefault()
  }

  document.addEventListener('gesturestart', blockGesture, { passive: false })
  document.addEventListener('gesturechange', blockGesture, { passive: false })
  document.addEventListener('gestureend', blockGesture, { passive: false })

  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) {
        event.preventDefault()
      }
    },
    { passive: false },
  )

  // Mac 触控板捏合在桌面浏览器里表现为带 ctrlKey 的 wheel，而非 gesture*。
  document.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) {
        event.preventDefault()
      }
    },
    { passive: false },
  )
}
