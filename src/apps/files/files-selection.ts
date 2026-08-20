/**
 * 文件管理器多选纯函数：区间选择、框选相交、集合切换。
 * 与 DOM/组件无关，便于单测。
 */

export type FilesSelectionRect = {
  left: number
  top: number
  right: number
  bottom: number
}

/** 两矩形是否相交（含边重合） */
export function rectsIntersect(a: FilesSelectionRect, b: FilesSelectionRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

/**
 * Shift 区间选择：返回有序 id 列表中 anchor 与 target 之间（含两端）的全部 id。
 * anchor 不在列表中时退化为仅 target。
 */
export function rangeSelection(
  orderedIds: readonly string[],
  anchorId: string | undefined,
  targetId: string,
): Set<string> {
  const result = new Set<string>()
  if (anchorId === undefined || !orderedIds.includes(anchorId)) {
    result.add(targetId)
    return result
  }
  const anchorIndex = orderedIds.indexOf(anchorId)
  const targetIndex = orderedIds.indexOf(targetId)
  if (targetIndex < 0) {
    result.add(targetId)
    return result
  }
  const [from, to] =
    anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
  for (let index = from; index <= to; index += 1) {
    const id = orderedIds[index]
    if (id !== undefined) result.add(id)
  }
  return result
}

/**
 * 框选：返回与 marquee 矩形相交的条目 id（保持输入顺序）。
 * 未提供矩形（框宽高为 0 的误触）时返回空集。
 */
export function marqueeSelection(
  entries: readonly { id: string; rect: FilesSelectionRect }[],
  marquee: FilesSelectionRect,
): string[] {
  const width = Math.abs(marquee.right - marquee.left)
  const height = Math.abs(marquee.bottom - marquee.top)
  if (width <= 1 && height <= 1) return []
  const box = {
    left: Math.min(marquee.left, marquee.right),
    top: Math.min(marquee.top, marquee.bottom),
    right: Math.max(marquee.left, marquee.right),
    bottom: Math.max(marquee.top, marquee.bottom),
  }
  const selected: string[] = []
  for (const entry of entries) {
    if (rectsIntersect(box, entry.rect)) {
      selected.push(entry.id)
    }
  }
  return selected
}

/** 集合切换：含则移除，不含则加入（返回新集合） */
export function toggleInSet(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}
