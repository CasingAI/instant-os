/** 阻止 iOS Safari / iPad 上的整页双击缩放与双指捏合缩放（模拟桌面 OS 时不应放大浏览器视口）。 */
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
}
