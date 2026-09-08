/**
 * 导航的纯逻辑（可单测）：宽屏帧转场窗口的底层/顶层匹配。
 */

/** 帧窗口两侧的下标：push = 旧顶退守（under）+ 新顶滑入（over）；
 * pop = 新顶回位（under）+ 退场帧滑出（over）。-1 表示这一侧没有帧。 */
export function wideNavFrameIndices(
  frameNav: 'push' | 'pop' | undefined,
  active: number,
): { navUnder: number; navOver: number } {
  const navUnder = frameNav === 'push' ? active - 1 : frameNav === 'pop' ? active : -1
  const navOver = frameNav === 'push' ? active : frameNav === 'pop' ? active + 1 : -1
  return { navUnder, navOver }
}

export function wideNavExitingIds(
  frames: readonly string[],
  previous: readonly string[],
  previousLength: number,
  exiting: readonly string[],
  reset: boolean,
): string[] {
  if (reset || Math.abs(frames.length - previousLength) > 1) return []
  const removed = frames.length < previousLength ? previous.slice(frames.length) : exiting
  return removed.filter((id) => !frames.includes(id))
}

/** 退出页复用上次内容，不能再用已更新的应用状态生成空页。 */
export function wideNavPage<T>(
  id: string,
  exiting: boolean,
  previous: ReadonlyMap<string, T>,
  render: () => T,
): T {
  return exiting && previous.has(id) ? previous.get(id)! : render()
}

/** host 是否命中窗口下标。host 不在帧序列里时 indexOf 是 -1，必须与
 * 「这一侧没有帧」的 -1 区分，否则从列表点进首个子页（push、active=0）
 * 时左栏列表会被误标成 under，拆盒后变成并排卡片。 */
export function hitsNavFrameIndex(frameIndex: number, navIndex: number): boolean {
  return frameIndex >= 0 && frameIndex === navIndex
}
