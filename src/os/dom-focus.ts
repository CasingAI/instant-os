/**
 * 把 DOM 焦点交还系统外壳（body）。
 *
 * 窗口散开等「窗口失活」路径只清 WM 级 activeWindowId；DOM 焦点若残留在
 * 窗口内容（输入框 / iframe）上，键盘事件仍派发到那个元素——桌面打字即搜
 * （desktop-app-search）会因此收不到 keydown 或被 blocked-target 拦截。
 */
export function releaseDomFocusToShell(): void {
  const active = document.activeElement
  if (active === null || active === document.body || active === document.documentElement) {
    return
  }
  const element = active as HTMLElement
  if (typeof element.blur === 'function') {
    element.blur()
  }
}
